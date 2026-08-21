import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CircleHelp,
  Clock3,
  Database,
  Gauge,
  ShieldAlert,
  Wrench,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Health = "healthy" | "degraded" | "blocked" | "unknown";
type ValidationState = "passed" | "failed" | "waiting" | "skipped";

type Evidence = {
  source: string;
  summary: string;
  collectedAt: string;
};

type DiagnosticReport = {
  id: string;
  moduleId: string;
  category: string;
  priority: "P0" | "P1" | "P2" | "P3";
  disposition: string;
  symptom: string;
  rootCause: string | null;
  candidateRootCauses: string[];
  impactScope: string;
  recommendedFix: string;
  verification: { state: ValidationState; reason: string; checkedAt: string };
  remainingRisk: string;
  evidence: Evidence[];
};

type DiagnosticsSnapshot = {
  generatedAt: string;
  overall: { state: Health; score: number; reason: string };
  modules: Array<{
    id: string;
    label: string;
    category: string;
    state: Health;
    freshness: string;
    disposition: string;
    impactScope: string;
    reason: string;
    evidence: Evidence;
  }>;
  activeAlerts: DiagnosticReport[];
  knownIssues: DiagnosticReport[];
  recentEvents: Array<{
    id: string;
    kind: "detected" | "recovery" | "observation";
    occurredAt: string;
    moduleId: string;
    category: string;
    priority: string;
    disposition: string;
    summary: string;
  }>;
  knowledgeBase: Array<{
    id: string;
    title: string;
    status: "resolved" | "reference";
    summary: string;
    lesson: string;
    verification: string;
    remainingRisk: string;
    categories: string[];
  }>;
  validations: Array<{ id: string; label: string; state: ValidationState; reason: string; checkedAt: string }>;
  futureEngines: {
    selfHealing: string;
    predictiveDiagnostics: string;
    learningEngine: string;
    reason: string;
  };
  persistence: { state: string; reason: string };
};

const apiPath = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/radar/diagnostics`;

async function fetchDiagnostics(): Promise<DiagnosticsSnapshot> {
  const response = await fetch(apiPath);
  if (!response.ok) throw new Error("Diagnostics endpoint is unavailable");
  return response.json() as Promise<DiagnosticsSnapshot>;
}

function timestamp(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "Not observed"
    : parsed.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function healthClass(state: string): string {
  if (state === "healthy" || state === "passed") return "text-emerald-600 border-emerald-500/30 bg-emerald-500/10";
  if (state === "degraded" || state === "waiting") return "text-amber-600 border-amber-500/30 bg-amber-500/10";
  if (state === "blocked" || state === "failed") return "text-destructive border-destructive/30 bg-destructive/10";
  return "text-muted-foreground border-border bg-muted";
}

function HealthIcon({ state }: { state: string }) {
  if (state === "healthy" || state === "passed") return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (state === "blocked" || state === "failed") return <XCircle className="h-4 w-4 text-destructive" />;
  if (state === "degraded" || state === "waiting") return <AlertTriangle className="h-4 w-4 text-amber-600" />;
  return <CircleHelp className="h-4 w-4 text-muted-foreground" />;
}

function ReportCard({ report }: { report: DiagnosticReport }) {
  const cause = report.rootCause ?? report.candidateRootCauses[0] ?? "No cause is assigned until more evidence is collected.";
  return (
    <article className="rounded-md border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge variant="outline" className={cn("font-mono text-[10px]", healthClass(report.priority === "P0" || report.priority === "P1" ? "blocked" : "degraded"))}>
          {report.priority}
        </Badge>
        <Badge variant="outline" className="font-mono text-[10px]">{report.category}</Badge>
        <span className="text-xs text-muted-foreground">{report.moduleId}</span>
      </div>
      <p className="font-medium">{report.symptom}</p>
      <dl className="mt-4 grid gap-3 text-sm">
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Attribution</dt>
          <dd className="mt-1 text-muted-foreground">{cause}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Impact</dt>
          <dd className="mt-1 text-muted-foreground">{report.impactScope}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Recommended action</dt>
          <dd className="mt-1 text-muted-foreground">{report.recommendedFix}</dd>
        </div>
        {report.evidence[0] && (
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Evidence</dt>
            <dd className="mt-1 text-muted-foreground">{report.evidence[0].summary} <span className="font-mono text-[10px]">({report.evidence[0].source})</span></dd>
          </div>
        )}
      </dl>
      <div className="mt-4 border-t border-border pt-3 text-xs">
        <div className="flex items-center gap-2">
          <HealthIcon state={report.verification.state} />
          <span className="font-medium uppercase tracking-wide">{report.verification.state}</span>
          <span className="text-muted-foreground">automatic recheck</span>
        </div>
        <p className="mt-1 text-muted-foreground">{report.verification.reason}</p>
        <p className="mt-3 text-muted-foreground"><span className="font-medium text-foreground">Remaining risk:</span> {report.remainingRisk}</p>
      </div>
    </article>
  );
}

export default function DiagnosticsCenter() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["diagnostics-center"],
    queryFn: fetchDiagnostics,
    refetchInterval: 10_000,
  });

  if (isLoading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Activity className="h-7 w-7 animate-pulse" />
          <span className="text-sm">Collecting read-only diagnostic evidence…</span>
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="min-h-[100dvh] bg-background px-4 py-10 text-foreground">
        <div className="mx-auto max-w-2xl">
          <Link href="/" className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back to Alpha Radar
          </Link>
          <Card className="border-destructive/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-destructive" /> Diagnostics unavailable</CardTitle>
              <CardDescription>The dashboard cannot retrieve the read-only Diagnostics Center report. Alpha Radar market and Alert paths remain independently isolated.</CardDescription>
            </CardHeader>
          </Card>
        </div>
      </div>
    );
  }

  const attentionModules = data.modules.filter((module) => module.state !== "healthy").length;
  return (
    <div className="min-h-[100dvh] bg-background pb-12 text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-muted-foreground transition-colors hover:text-foreground" aria-label="Back to Alpha Radar">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary"><Activity className="h-5 w-5" /></div>
            <div>
              <h1 className="text-lg font-semibold leading-none">Diagnostics Center</h1>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Evidence-first operational view</p>
            </div>
          </div>
          <Badge variant="outline" className={cn("font-mono text-xs uppercase", healthClass(data.overall.state))}>{data.overall.state}</Badge>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-12">
        <Card className={cn("lg:col-span-12", healthClass(data.overall.state))}>
          <CardContent className="flex flex-col justify-between gap-5 p-6 sm:flex-row sm:items-center">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest">Unified health</p>
              <div className="mt-2 flex items-baseline gap-3">
                <span className="font-mono text-4xl font-bold uppercase">{data.overall.state}</span>
                <span className="font-mono text-lg">{data.overall.score}/100</span>
              </div>
              <p className="mt-3 max-w-3xl text-sm text-muted-foreground">{data.overall.reason}</p>
            </div>
            <div className="flex items-center gap-3 rounded-md border border-current/20 bg-background/40 px-4 py-3 text-sm">
              <Gauge className="h-5 w-5" />
              <span>{attentionModules} module{attentionModules === 1 ? "" : "s"} need attention</span>
            </div>
          </CardContent>
        </Card>

        <section className="space-y-6 lg:col-span-7">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Module health</CardTitle>
              <CardDescription>Fresh, direct observations only. Heartbeats and reference data do not substitute for market evidence.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.modules.map((module) => (
                <div key={module.id} className="rounded-md border border-border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <HealthIcon state={module.state} />
                      <div>
                        <p className="font-medium">{module.label}</p>
                        <p className="text-xs text-muted-foreground">{module.category} · {module.freshness} evidence</p>
                      </div>
                    </div>
                    <Badge variant="outline" className={cn("font-mono text-[10px]", healthClass(module.state))}>{module.state}</Badge>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">{module.reason}</p>
                  {module.state !== "healthy" && <p className="mt-2 text-xs text-muted-foreground"><span className="font-medium text-foreground">Disposition:</span> {module.disposition} · {module.impactScope}</p>}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><ShieldAlert className="h-4 w-4" /> Active alerts and diagnosis</CardTitle>
              <CardDescription>P0–P1 alerts surface immediate operational impact. Attribution remains explicit when evidence is constrained.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.activeAlerts.length ? data.activeAlerts.map((report) => <ReportCard key={report.id} report={report} />) : <p className="py-6 text-center text-sm text-muted-foreground">No P0 or P1 diagnostic alerts are active.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Wrench className="h-4 w-4" /> Constrained conditions</CardTitle>
              <CardDescription>Includes data availability, governance, configuration, and permission/subscription constraints without calling them code defects.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.knownIssues.length ? data.knownIssues.map((report) => <ReportCard key={report.id} report={report} />) : <p className="py-6 text-center text-sm text-muted-foreground">No active constrained conditions.</p>}
            </CardContent>
          </Card>
        </section>

        <aside className="space-y-6 lg:col-span-5">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Clock3 className="h-4 w-4" /> Health timeline</CardTitle>
              <CardDescription>Bounded, process-local V1 event history.</CardDescription>
            </CardHeader>
            <CardContent>
              {data.recentEvents.length ? (
                <ol className="space-y-4 border-l border-border pl-5">
                  {data.recentEvents.map((event) => (
                    <li key={event.id} className="relative">
                      <span className={cn("absolute -left-[25px] top-1 h-2.5 w-2.5 rounded-full ring-4 ring-background", event.kind === "recovery" ? "bg-emerald-500" : event.priority === "P0" || event.priority === "P1" ? "bg-destructive" : "bg-amber-500")} />
                      <p className="text-[10px] font-mono uppercase text-muted-foreground">{timestamp(event.occurredAt)} · {event.kind} · {event.priority}</p>
                      <p className="mt-1 text-sm">{event.summary}</p>
                    </li>
                  ))}
                </ol>
              ) : <p className="py-6 text-center text-sm text-muted-foreground">No changes recorded since this process began.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Automatic verification</CardTitle>
              <CardDescription>Every collection refresh reruns the relevant health checks after recovery.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.validations.map((validation) => (
                <div key={validation.id} className="flex items-start gap-3 border-b border-border pb-3 last:border-0 last:pb-0">
                  <HealthIcon state={validation.state} />
                  <div>
                    <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium">{validation.label}</p><Badge variant="outline" className={cn("text-[10px]", healthClass(validation.state))}>{validation.state}</Badge></div>
                    <p className="mt-1 text-xs text-muted-foreground">{validation.reason}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Database className="h-4 w-4" /> Diagnostic knowledge</CardTitle>
              <CardDescription>Resolved cases and reference rules for future triage.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {data.knowledgeBase.map((entry) => (
                <article key={entry.id} className="rounded-md border border-border p-3">
                  <div className="flex items-center justify-between gap-2"><p className="text-sm font-medium">{entry.title}</p><Badge variant="outline" className="text-[10px]">{entry.status}</Badge></div>
                  <p className="mt-2 text-xs text-muted-foreground">{entry.lesson}</p>
                </article>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Future engine boundaries</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              <p><span className="font-medium text-foreground">Self-healing:</span> {data.futureEngines.selfHealing}</p>
              <p><span className="font-medium text-foreground">Prediction:</span> {data.futureEngines.predictiveDiagnostics}</p>
              <p><span className="font-medium text-foreground">Learning:</span> {data.futureEngines.learningEngine}</p>
              <p className="border-t border-border pt-2">{data.futureEngines.reason}</p>
              <p className="border-t border-border pt-2"><span className="font-medium text-foreground">Storage:</span> {data.persistence.state} — {data.persistence.reason}</p>
            </CardContent>
          </Card>
        </aside>
      </main>
    </div>
  );
}