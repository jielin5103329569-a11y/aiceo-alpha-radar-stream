const styles = `
  :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #090b10; color: #f3f4f6; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; background: #090b10; }
  main { width: min(920px, calc(100% - 32px)); margin: 0 auto; padding: 48px 0 72px; }
  h1 { margin: 0 0 8px; font-size: clamp(28px, 6vw, 44px); letter-spacing: -0.04em; }
  h2 { margin: 0 0 16px; font-size: 18px; }
  p { color: #a9b0bd; line-height: 1.6; }
  a, button { border: 0; border-radius: 8px; background: #f3f4f6; color: #111318; cursor: pointer; display: inline-block; font: inherit; font-weight: 700; padding: 11px 16px; text-decoration: none; }
  button:disabled { cursor: not-allowed; opacity: .45; }
  .secondary { background: #252a34; color: #f3f4f6; }
  .card { background: #11141b; border: 1px solid #262b35; border-radius: 12px; margin-top: 20px; padding: 20px; }
  .grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); }
  .field { background: #0c0f14; border: 1px solid #222731; border-radius: 8px; padding: 12px; }
  .label { color: #7f8795; display: block; font-size: 12px; font-weight: 700; letter-spacing: .08em; margin-bottom: 6px; text-transform: uppercase; }
  .value { overflow-wrap: anywhere; }
  .status { border-radius: 8px; margin: 20px 0; padding: 12px 14px; }
  .status.info { background: #101b2b; color: #b9d5ff; }
  .status.error { background: #2a1317; color: #ffb9c2; }
  .status.success { background: #102419; color: #b6efc9; }
  form { display: grid; gap: 14px; }
  label { color: #d6dae1; display: grid; gap: 7px; }
  textarea, input[type="text"] { background: #090b10; border: 1px solid #343a46; border-radius: 8px; color: #f3f4f6; font: inherit; min-height: 96px; padding: 10px; width: 100%; }
  input[type="text"] { min-height: auto; }
  .checks { display: grid; gap: 9px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
  .check { align-items: center; display: flex; gap: 8px; }
  pre { background: #090b10; border: 1px solid #222731; border-radius: 8px; color: #cdd3de; max-height: 280px; overflow: auto; padding: 12px; white-space: pre-wrap; }
  .actions { display: flex; flex-wrap: wrap; gap: 10px; }
  [hidden] { display: none !important; }
`;

const page = (title: string, body: string, script: string) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>${title}</title>
  <style>${styles}</style>
</head>
<body>
${body}
<script>${script}</script>
</body>
</html>`;

export const aiceoGovHomePage = () => page(
  "AICEO Governance",
  `<main>
    <span class="label">AICEO Minimum Governance Surface</span>
    <h1>Owner governance</h1>
    <p>This isolated surface exposes only the persisted Task 73 governance record. It does not reuse IMPL-001 approval evidence.</p>
    <div id="status" class="status info">Checking Clerk role…</div>
    <div class="actions">
      <a id="sign-in" href="/gov/login">Sign in with Clerk</a>
      <a id="open-task" class="secondary" href="/gov/tasks/73" hidden>Open Task 73</a>
    </div>
  </main>`,
  `
    fetch("/gov/me", { headers: { Accept: "application/json" }, credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Sign in as the exclusive OWNER or aiceo_validator.");
        const me = await response.json();
        document.getElementById("status").textContent = "Signed in as " + me.userId;
        document.getElementById("status").className = "status success";
        document.getElementById("sign-in").hidden = true;
        document.getElementById("open-task").hidden = false;
      })
      .catch((error) => {
        document.getElementById("status").textContent = error.message;
        document.getElementById("status").className = "status info";
      });
  `,
);

export const aiceoGovLoginPage = () => page(
  "AICEO Governance Sign In",
  `<main>
    <span class="label">AICEO Minimum Governance Surface</span>
    <h1>Owner governance access</h1>
    <p>This isolated page uses the project's existing Clerk session. Governance data remains unavailable without an authenticated user holding only the <strong>OWNER</strong> or <strong>aiceo_validator</strong> role.</p>
    <div id="status" class="status info">Checking Clerk session…</div>
    <div class="actions">
      <a id="sign-in" href="/sign-in">Sign in with Clerk</a>
      <a id="open-task" class="secondary" href="/gov/tasks/73" hidden>Open Task 73</a>
    </div>
  </main>`,
  `
    document.getElementById("sign-in").href = "/sign-in?redirect_url="
      + encodeURIComponent(window.location.origin + "/gov/sso-callback");
    fetch("/gov/me", { headers: { Accept: "application/json" }, credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Sign in with an exclusive OWNER or aiceo_validator role to continue.");
        const me = await response.json();
        document.getElementById("status").textContent = "Signed in as " + me.userId;
        document.getElementById("status").className = "status success";
        document.getElementById("sign-in").hidden = true;
        document.getElementById("open-task").hidden = false;
      })
      .catch((error) => {
        document.getElementById("status").textContent = error.message;
        document.getElementById("status").className = "status info";
      });
  `,
);

export const aiceoGovSsoCallbackPage = () => page(
  "AICEO Governance — Sign In Complete",
  `<main>
    <span class="label">AICEO Minimum Governance Surface</span>
    <h1>Sign-in complete</h1>
    <p>Opening the isolated Task 73 governance record.</p>
    <div class="actions">
      <a href="/gov/tasks/73">Continue to Task 73</a>
    </div>
  </main>`,
  `window.location.replace("/gov/tasks/73");`,
);

export const aiceoGovTask73Page = () => page(
  "AICEO Governance — Task 73",
  `<main>
    <span class="label">AICEO Minimum Governance Surface</span>
    <h1>Task 73</h1>
    <p>Read the persisted execution evidence before submitting an independent decision. No action on this page bypasses the existing governance protocol.</p>
    <div id="status" class="status info">Loading protected task data…</div>
    <div id="auth-action" class="actions" hidden>
      <a href="/gov/login">Go to governance sign in</a>
    </div>

    <section id="task" hidden>
      <div class="card">
        <h2>Task fields</h2>
        <div class="grid">
          <div class="field"><span class="label">Task ID</span><span id="task-id" class="value"></span></div>
          <div class="field"><span class="label">Execution identity</span><span id="execution-identity" class="value"></span></div>
          <div class="field"><span class="label">Validator identity</span><span id="validator-identity" class="value"></span></div>
          <div class="field"><span class="label">Verification result</span><span id="verification-result" class="value"></span></div>
          <div class="field"><span class="label">Closure state</span><span id="closure-state" class="value"></span></div>
          <div class="field"><span class="label">Revision 49 contract</span><span id="contract" class="value"></span></div>
        </div>
      </div>
      <div class="card">
        <h2>Lifecycle</h2>
        <pre id="lifecycle"></pre>
      </div>
      <div class="card">
        <h2>Evidence</h2>
        <pre id="evidence"></pre>
      </div>

      <div class="card">
        <h2>Independent verification</h2>
        <form id="verify-form">
          <div class="checks">
            <label class="check"><input type="checkbox" name="authority"> Authority compliant</label>
            <label class="check"><input type="checkbox" name="scope"> Scope compliant</label>
            <label class="check"><input type="checkbox" name="understanding"> Understanding compliant</label>
            <label class="check"><input type="checkbox" name="intentGate"> Intent gate compliant</label>
            <label class="check"><input type="checkbox" name="noDuplicate"> No duplicate execution</label>
            <label class="check"><input type="checkbox" name="noOwnerInterruption"> No Owner interruption</label>
            <label class="check"><input type="checkbox" name="evidence"> Evidence sufficient</label>
            <label class="check"><input type="checkbox" name="passed"> Verification passes</label>
          </div>
          <label>Verification evidence as a JSON array
            <textarea name="verificationEvidence" required placeholder='[{"source":"review","finding":"..."}]'></textarea>
          </label>
          <button type="submit">Submit independent verification</button>
        </form>
      </div>

      <div class="card">
        <h2>Closure</h2>
        <form id="close-form">
          <label>Closure reason
            <input type="text" name="reason" required maxlength="2000">
          </label>
          <label>Closure evidence as a JSON array
            <textarea name="closureEvidence" placeholder='[{"source":"acceptance","finding":"..."}]'></textarea>
          </label>
          <button type="submit">Close Task 73</button>
        </form>
      </div>
    </section>
  </main>`,
  `
    const statusNode = document.getElementById("status");
    const taskNode = document.getElementById("task");
    const authAction = document.getElementById("auth-action");
    const showStatus = (message, kind = "info") => {
      statusNode.textContent = message;
      statusNode.className = "status " + kind;
    };
    const display = (value) => value === null || value === undefined ? "Not recorded" : String(value);
    const render = (task) => {
      document.getElementById("task-id").textContent = display(task.taskId);
      document.getElementById("execution-identity").textContent = display(task.executionIdentity);
      document.getElementById("validator-identity").textContent = display(task.validatorIdentity);
      document.getElementById("verification-result").textContent = task.verificationResult
        ? task.verificationResult.finalStatus + " (" + task.verificationResult.passed + ")"
        : "Not verified";
      document.getElementById("closure-state").textContent = display(task.closureState);
      document.getElementById("contract").textContent = task.contractRevision49.status
        + " · revision " + task.contractRevision49.revision
        + " · " + display(task.contractRevision49.id);
      document.getElementById("lifecycle").textContent = JSON.stringify(task.lifecycle, null, 2);
      document.getElementById("evidence").textContent = JSON.stringify(task.evidence, null, 2);
      taskNode.hidden = false;
      authAction.hidden = true;
    };
    const parseArray = (value, required) => {
      if (!value.trim() && !required) return [];
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed) || (required && parsed.length === 0)) {
        throw new Error("Evidence must be a" + (required ? " non-empty" : "") + " JSON array.");
      }
      return parsed;
    };
    const request = async (url, options = {}) => {
      const response = await fetch(url, {
        ...options,
        credentials: "same-origin",
        headers: { Accept: "application/json", ...(options.headers || {}) },
      });
      const body = await response.json().catch(() => ({ error: "Unexpected server response." }));
      if (!response.ok) throw new Error(body.error || ("Request failed with " + response.status));
      return body;
    };
    const load = () => request("/gov/tasks/73").then((task) => {
      render(task);
      showStatus("Protected Task 73 data loaded.", "success");
    }).catch((error) => {
      taskNode.hidden = true;
      authAction.hidden = false;
      showStatus(error.message, "error");
    });

    document.getElementById("verify-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      try {
        const evidence = parseArray(String(form.get("verificationEvidence") || ""), true);
        const compliance = {};
        ["authority","scope","understanding","intentGate","noDuplicate","noOwnerInterruption","evidence"]
          .forEach((key) => { compliance[key] = form.get(key) === "on"; });
        showStatus("Submitting independent verification…");
        render(await request("/gov/tasks/73/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ passed: form.get("passed") === "on", compliance, evidence }),
        }));
        showStatus("Verification response persisted.", "success");
      } catch (error) {
        showStatus(error.message, "error");
      }
    });

    document.getElementById("close-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      try {
        const evidence = parseArray(String(form.get("closureEvidence") || ""), false);
        showStatus("Submitting closure request…");
        render(await request("/gov/tasks/73/close", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: String(form.get("reason") || ""), evidence }),
        }));
        showStatus("Closure response persisted.", "success");
      } catch (error) {
        showStatus(error.message, "error");
      }
    });
    load();
  `,
);