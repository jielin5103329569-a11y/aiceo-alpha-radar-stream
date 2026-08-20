import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const bridgePath = "artifacts/api-server/src/lib/databento_reference_bridge.py";
const probe = `
import importlib.util
import sys
import types

sys.modules["databento"] = types.SimpleNamespace()
spec = importlib.util.spec_from_file_location("reference_bridge", "${bridgePath}")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

start, end = module.definition_query_range({
    "schema": {
        "definition": {
            "start": "2026-08-01T00:00:00Z",
            "end": "2026-08-20T00:00:00Z",
        }
    }
})
assert start.isoformat() == "2026-08-19T00:00:00+00:00"
assert end.isoformat() == "2026-08-20T00:00:00+00:00"
assert start < end

short_start, short_end = module.definition_query_range({
    "schema": {
        "definition": {
            "start": "2026-08-19T23:59:00Z",
            "end": "2026-08-20T00:00:00Z",
        }
    }
})
assert short_start.isoformat() == "2026-08-19T23:59:00+00:00"
assert short_start < short_end

try:
    module.definition_query_range({
        "schema": {
            "definition": {
                "start": "2026-08-20T00:00:00Z",
                "end": "2026-08-20T00:00:00Z",
            }
        }
    })
except RuntimeError:
    pass
else:
    raise AssertionError("zero-length availability must fail before a Databento query")
`;

const result = spawnSync("python3", ["-c", probe], { encoding: "utf8" });
assert.equal(result.status, 0, result.stderr || result.stdout);
console.log("Databento reference bridge tests passed: definition queries always use a non-empty end-exclusive interval.");