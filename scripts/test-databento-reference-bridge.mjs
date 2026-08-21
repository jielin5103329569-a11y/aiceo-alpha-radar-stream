import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const bridgePath = "artifacts/api-server/src/lib/databento_reference_bridge.py";
const probe = `
from datetime import UTC, datetime
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

class FakeSeries:
    def max(self):
        return datetime(2026, 8, 20, tzinfo=UTC)

class FakeFrame:
    empty = False
    columns = ["ts_effective"]
    def reset_index(self):
        return self
    def __getitem__(self, key):
        assert key == "ts_effective"
        return FakeSeries()
    def iterrows(self):
        return iter([(
            0,
            {
                "nasdaq_symbol": "ACME",
                "security_id": "security-acme",
                "listing_id": "listing-acme",
                "issuer_name": "Acme AI",
                "listing_status": "active",
                "security_type": "common stock",
                "sector": "Technology",
                "industry_group": "Semiconductors",
                "industry": "AI chips",
                "classification_source": "licensed",
                "ts_effective": datetime(2026, 8, 20, tzinfo=UTC),
                "listing_source": "primary",
            },
        )])

class FakeSecurityMaster:
    def get_last(self, **kwargs):
        assert kwargs["countries"] == ["US"]
        return FakeFrame()

class FakeReference:
    def __init__(self, key):
        self.security_master = FakeSecurityMaster()

events = []
module.db = types.SimpleNamespace(Reference=FakeReference)
module.write_event = events.append
module.security_master_snapshot("test-key")
assert events[0]["authorizationState"] == "verified"
assert events[1]["providerSymbol"] == "ACME"
assert events[1]["sector"] == "Technology"
assert events[1]["classificationSource"] == "licensed"
`;

const result = spawnSync("python3", ["-c", probe], { encoding: "utf8" });
assert.equal(result.status, 0, result.stderr || result.stdout);
console.log("Databento reference bridge tests passed: definition queries always use a non-empty end-exclusive interval.");