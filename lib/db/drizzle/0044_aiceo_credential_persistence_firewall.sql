CREATE OR REPLACE FUNCTION aiceo_credential_firewall_violation(value jsonb, path text DEFAULT '$')
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  item record;
  normalized_key text;
  scalar_text text;
  child_path text;
BEGIN
  IF $1 IS NULL OR $1 = 'null'::jsonb THEN RETURN NULL; END IF;

  IF jsonb_typeof($1) = 'object' THEN
    FOR item IN SELECT entry.key, entry.val FROM jsonb_each($1) AS entry(key, val) LOOP
      normalized_key := regexp_replace(lower(item.key), '[^a-z0-9]', '', 'g');
      child_path := path || '.' || item.key;
      IF normalized_key = ANY(ARRAY[
        'password','passwd','pwd','secret','token','accesstoken','refreshtoken',
        'apitoken','authtoken','idtoken','bearertoken','accesskey','secretkey',
        'xapikey','xauthtoken',
        'apikey','authorization','credential','credentials','privatekey','clientsecret',
        'cookie','setcookie','sessionid','sessiontoken'
      ]) AND item.val IS DISTINCT FROM 'null'::jsonb AND item.val IS DISTINCT FROM '""'::jsonb THEN
        RETURN 'credential_field@' || child_path;
      END IF;
      scalar_text := aiceo_credential_firewall_violation(item.val, child_path);
      IF scalar_text IS NOT NULL THEN RETURN scalar_text; END IF;
    END LOOP;
    RETURN NULL;
  END IF;

  IF jsonb_typeof($1) = 'array' THEN
    FOR item IN
      SELECT element.item_value AS val, element.ordinality
      FROM jsonb_array_elements($1) WITH ORDINALITY AS element(item_value, ordinality)
    LOOP
      scalar_text := aiceo_credential_firewall_violation(item.val, path || '[' || item.ordinality::text || ']');
      IF scalar_text IS NOT NULL THEN RETURN scalar_text; END IF;
    END LOOP;
    RETURN NULL;
  END IF;

  IF jsonb_typeof($1) <> 'string' THEN RETURN NULL; END IF;
  scalar_text := $1 #>> '{}';
  IF scalar_text ~* '-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----'
    THEN RETURN 'private_key@' || path; END IF;
  IF scalar_text ~* '\mBearer[[:space:]]+[A-Za-z0-9._~+/-]{8,}={0,2}\M'
    THEN RETURN 'authorization_bearer@' || path; END IF;
  IF scalar_text ~* '\mAuthorization[[:space:]]*:[[:space:]]*Basic[[:space:]]+[A-Za-z0-9+/]{12,}={0,2}\M'
    THEN RETURN 'authorization_basic@' || path; END IF;
  IF scalar_text ~* '\m[a-z][a-z0-9+.-]*://[^/[:space:]:@]+:[^@[:space:]/]+@[^[:space:]]+'
    THEN RETURN 'credential_url@' || path; END IF;
  IF scalar_text ~ '\m(sk-((live|test|proj)-?)?[A-Za-z0-9_-]{12,}|rk_live_[A-Za-z0-9]{12,}|whsec_[A-Za-z0-9]{12,}|xai-[A-Za-z0-9_-]{12,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\M'
    THEN RETURN 'known_secret_format@' || path; END IF;
  IF scalar_text ~* '\m(password|passwd|pwd|secret|access[_ -]?token|refresh[_ -]?token|api[_ -]?token|auth[_ -]?token|id[_ -]?token|bearer[_ -]?token|access[_ -]?key|secret[_ -]?key|x[_ -]?api[_ -]?key|x[_ -]?auth[_ -]?token|session[_ -]?(id|token)|token|api[_ -]?key|client[_ -]?secret|credential|set[_ -]?cookie|cookie)s?\M[[:space:]]*(is|=|:)[[:space:]]*["'']?[^[:space:]"'',;}{\]]{6,}'
    THEN RETURN 'credential_assignment@' || path; END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION aiceo_install_credential_firewall_on_ddl()
RETURNS event_trigger
LANGUAGE plpgsql
AS $$
DECLARE
  command record;
  target record;
  trigger_name text;
BEGIN
  FOR command IN SELECT * FROM pg_event_trigger_ddl_commands() LOOP
    SELECT n.nspname AS schema_name, c.relname AS table_name, c.relkind
    INTO target
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.oid = command.objid;
    IF target.schema_name = 'public'
      AND target.relkind IN ('r', 'p')
      AND target.table_name LIKE 'aiceo\_%' ESCAPE '\'
    THEN
      trigger_name := left(target.table_name || '_credential_firewall', 63);
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I.%I FOR EACH ROW EXECUTE FUNCTION public.aiceo_credential_persistence_guard()',
        trigger_name,
        target.schema_name,
        target.table_name
      );
    END IF;
  END LOOP;
END;
$$;

DROP EVENT TRIGGER IF EXISTS aiceo_credential_firewall_on_table_create;
CREATE EVENT TRIGGER aiceo_credential_firewall_on_table_create
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS')
  EXECUTE FUNCTION aiceo_install_credential_firewall_on_ddl();

CREATE OR REPLACE FUNCTION aiceo_credential_persistence_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  violation text;
BEGIN
  violation := aiceo_credential_firewall_violation(to_jsonb(NEW));
  IF violation IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'AICEO credential persistence blocked',
      DETAIL = split_part(violation, '@', 1);
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  target record;
  trigger_name text;
  violating_rows bigint;
BEGIN
  FOR target IN
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema()
      AND c.relkind IN ('r', 'p')
      AND c.relname LIKE 'aiceo\_%' ESCAPE '\'
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %I row_data WHERE aiceo_credential_firewall_violation(to_jsonb(row_data)) IS NOT NULL',
      target.table_name
    ) INTO violating_rows;
    IF violating_rows > 0 THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'AICEO credential firewall preflight failed',
        DETAIL = target.table_name;
    END IF;
    trigger_name := left(target.table_name || '_credential_firewall', 63);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', trigger_name, target.table_name);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION aiceo_credential_persistence_guard()',
      trigger_name,
      target.table_name
    );
  END LOOP;
END;
$$;