import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetAiceoGovernanceAcceptance,
  getGetAiceoGovernanceAcceptanceQueryKey,
  useCreateAiceoGovernanceAcceptanceTask,
  useApproveAiceoOwnerGovernance,
  type AiceoGovernanceAcceptanceTask,
  type AiceoGovernanceAuditEvent
} from '@workspace/api-client-react';
import { useAuth } from '@clerk/react';
import { Redirect } from 'wouter';
import {
  ShieldCheck,
  ShieldAlert,
  ArrowLeft,
  Key,
  Fingerprint,
  CheckCircle2,
  AlertTriangle,
  Gavel,
  Activity,
  FileSignature,
  FileText,
  Lock,
  Ban
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { AccountControls } from '@/components/account-controls';
import { cn, formatTime } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

function GovernanceAcceptancePage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, error, isLoading } = useGetAiceoGovernanceAcceptance({
    query: {
      refetchInterval: 5000,
      retry: false,
      queryKey: getGetAiceoGovernanceAcceptanceQueryKey(),
    }
  });

  const createTestTask = useCreateAiceoGovernanceAcceptanceTask({
    mutation: {
      onSuccess: () => {
        toast({
          title: "Test Task Requested",
          description: "A new governance verification task has been created.",
        });
        queryClient.invalidateQueries({ queryKey: getGetAiceoGovernanceAcceptanceQueryKey() });
      },
      onError: () => {
        toast({
          title: "Request Failed",
          description: "Could not create the test task. You may lack operator authority.",
          variant: "destructive"
        });
      }
    }
  });

  const approveTask = useApproveAiceoOwnerGovernance({
    mutation: {
      onSuccess: () => {
        toast({
          title: "Task Approved",
          description: "Your cryptographic approval has been recorded.",
        });
        queryClient.invalidateQueries({ queryKey: getGetAiceoGovernanceAcceptanceQueryKey() });
      },
      onError: () => {
        toast({
          title: "Approval Failed",
          description: "Could not approve the task. Ensure you have owner authority.",
          variant: "destructive"
        });
      }
    }
  });

  if (error) {
    return (
      <div className="min-h-[100dvh] w-full bg-background flex flex-col">
        <Header />
        <main className="flex-1 flex items-center justify-center p-4">
          <Card className="max-w-md w-full border-destructive/50 bg-destructive/10">
            <CardHeader className="text-center pb-2">
              <Ban className="h-12 w-12 mx-auto text-destructive mb-2" />
              <CardTitle className="text-destructive text-xl uppercase tracking-widest">Access Denied</CardTitle>
            </CardHeader>
            <CardContent className="text-center text-sm text-muted-foreground">
              You do not have the required role to view the governance acceptance console.
              This area is restricted to authorized owners, operators, and validators.
            </CardContent>
            <CardFooter className="flex justify-center">
              <Button variant="outline" asChild>
                <Link href="/">Return to Dashboard</Link>
              </Button>
            </CardFooter>
          </Card>
        </main>
      </div>
    );
  }

  if (isLoading && !data) {
    return (
      <div className="min-h-[100dvh] w-full bg-background flex flex-col">
        <Header />
        <main className="flex-1 flex items-center justify-center p-4">
          <div className="flex flex-col items-center gap-4 text-muted-foreground animate-pulse">
            <Activity className="h-8 w-8" />
            <p className="text-sm font-medium tracking-widest uppercase">Verifying Authority...</p>
          </div>
        </main>
      </div>
    );
  }

  const role = data?.role;
  const isOwner = role === 'aiceo_owner';
  const isOperator = role === 'aiceo_operator';

  return (
    <div className="min-h-[100dvh] w-full bg-background text-foreground pb-12">
      <Header />

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 mt-8 flex flex-col gap-8">
        
        {/* Authority Context Block */}
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <h2 className="text-xl font-semibold tracking-tight">Governance Acceptance</h2>
            <p className="text-sm text-muted-foreground">
              Complete a safe Development-only check that proves only the independent Owner can approve.
            </p>
          </div>

          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="p-4 sm:p-6 flex flex-col sm:flex-row gap-4 items-start sm:items-center">
              <div className="h-12 w-12 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                <ShieldCheck className="h-6 w-6 text-primary" />
              </div>
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold uppercase tracking-widest text-sm">Active Role: {formatRole(role)}</h3>
                  <Badge variant="outline" className="font-mono text-[10px] uppercase border-primary/30 text-primary">
                    Verified
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {isOwner && "You are signed in as the independent Owner. Review the safety boundaries before recording your approval."}
                  {isOperator && "Operator Authority: You can request governance verification tasks to validate the approval pipeline, but you cannot authorize them."}
                  {role === 'aiceo_validator' && "You have read-only access. You cannot create or approve this check."}
                </p>
              </div>
              {isOperator && (
                <div className="shrink-0 pt-2 sm:pt-0">
                  <Button 
                    onClick={() => createTestTask.mutate(undefined)}
                    disabled={createTestTask.isPending}
                    data-testid="button-create-test-task"
                  >
                    {createTestTask.isPending ? "Requesting..." : "Request Verification"}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 gap-3">
            <AuthorityBadge label="Safety check" value="Development only" />
            <div className="flex flex-col border border-border/50 rounded-md p-3 bg-card">
               <span className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Production</span>
               <span className="font-mono text-sm font-semibold text-destructive flex items-center gap-1">
                 <Ban className="h-3 w-3" />
                  {data?.productionAuthority === false ? 'NO AUTHORITY' : 'UNKNOWN'}
               </span>
            </div>
          </div>
        </section>

        {/* Tasks List */}
        <section className="flex flex-col gap-4">
          <h3 className="text-lg font-medium tracking-tight border-b border-border pb-2">Pending and recent checks</h3>
          
          {data?.tasks && data.tasks.length > 0 ? (
            <div className="space-y-6">
              {data.tasks.map((task) => (
                <TaskCard 
                  key={task.id} 
                  task={task} 
                  isOwner={isOwner}
                  onApprove={(id) => approveTask.mutate({ id })}
                  isApproving={approveTask.isPending && approveTask.variables?.id === task.id}
                />
              ))}
            </div>
          ) : (
            <div className="py-12 border border-dashed border-border rounded-lg flex flex-col items-center justify-center text-center px-4 bg-muted/10">
              <CheckCircle2 className="h-10 w-10 text-muted-foreground/30 mb-3" />
              <p className="font-medium text-foreground">No governance tasks pending</p>
              <p className="text-sm text-muted-foreground mt-1">
                The acceptance queue is currently clear.
              </p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <Link 
              href="/" 
              className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted text-muted-foreground transition-colors"
              aria-label="Back to Dashboard"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <h1 className="font-semibold text-lg leading-none tracking-tight hidden sm:block">
                Governance Acceptance
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <AccountControls />
          </div>
        </div>
      </div>
    </header>
  );
}

function AuthorityBadge({ label, value, fullValue }: { label: string, value?: string, fullValue?: string }) {
  return (
    <div className="flex flex-col border border-border/50 rounded-md p-3 bg-card" title={fullValue}>
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">{label}</span>
      <span className="font-mono text-sm font-medium truncate">{value || '-'}</span>
    </div>
  );
}

function TaskCard({ 
  task, 
  isOwner, 
  onApprove, 
  isApproving 
}: { 
  task: AiceoGovernanceAcceptanceTask; 
  isOwner: boolean;
  onApprove: (id: string) => void;
  isApproving: boolean;
}) {
  const isApproved = !!task.ownerGovernanceApprovedAt;
  const isSafeAcceptanceTask = task.action === 'contract.echo'
    && task.resource === 'IMPL-001 fixed synthetic governance acceptance evidence; advisory text only; no side effects.'
    && task.environment === 'development'
    && task.governanceClassification === 'owner_protection'
    && task.ownerProtectionRedLines.length === 3
    && ['financial_and_physical_assets', 'legal_liability', 'aiceo_system_integrity']
      .every((redLine) => task.ownerProtectionRedLines.includes(redLine));
  
  return (
    <Card className={cn(
      "overflow-hidden transition-all duration-300",
      isApproved ? "border-muted-foreground/20 bg-muted/5 opacity-80" : "border-primary/30 shadow-sm"
    )} data-testid={`task-card-${task.id}`}>
      {/* Header */}
      <div className={cn(
        "px-4 sm:px-6 py-3 border-b flex flex-wrap items-center justify-between gap-3",
        isApproved ? "bg-muted/30 border-muted-foreground/10" : "bg-primary/5 border-primary/10"
      )}>
        <div className="flex items-center gap-3">
          {isApproved ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
          ) : (
            <AlertTriangle className="h-5 w-5 text-amber-500" />
          )}
          <div>
            <h4 className="text-sm font-semibold">Safe governance check</h4>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
              {formatTime(task.createdAt)}
            </p>
          </div>
        </div>
        <Badge variant={isApproved ? "outline" : "default"} className={cn(
          "font-mono text-[10px] uppercase tracking-wider",
          isApproved ? "text-emerald-500 border-emerald-500/30" : "bg-amber-500/20 text-amber-600 hover:bg-amber-500/30"
        )}>
          {isApproved ? "Approved" : "Pending Acceptance"}
        </Badge>
      </div>

      <CardContent className="p-0">
        <div className="grid grid-cols-1 md:grid-cols-12 divide-y md:divide-y-0 md:divide-x divide-border/50">
          
          {/* Main Info */}
          <div className="p-4 sm:p-6 md:col-span-7 space-y-6">
            
            {/* Intent & Action */}
            <div className="space-y-2">
              <h5 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-widest text-muted-foreground">
                <FileText className="h-3.5 w-3.5" /> What this check will do
              </h5>
              <p className="text-sm leading-relaxed">
                It records advisory test text only. It cannot use tools, change real assets, create legal consequences, or access production.
              </p>
              <div className="p-3 bg-muted/30 rounded-md border border-border/50 font-mono text-sm">
                <div className="grid grid-cols-[80px_1fr] gap-2">
                  <span className="text-muted-foreground">Action:</span>
                  <span className="font-medium">{task.action}</span>
                  <span className="text-muted-foreground">Resource:</span>
                  <span className="break-all">{task.resource}</span>
                </div>
              </div>
            </div>

            {/* Red Lines */}
            <div className="space-y-2">
              <h5 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-widest text-muted-foreground">
                <ShieldAlert className="h-3.5 w-3.5" /> Enforced Red Lines
              </h5>
              <div className="flex flex-col gap-2">
                {['financial_and_physical_assets', 'legal_liability', 'aiceo_system_integrity'].map((redLine) => {
                  const isCovered = task.ownerProtectionRedLines?.includes(redLine);
                  return (
                    <div key={redLine} className={cn(
                      "flex items-center gap-2 p-2 rounded text-xs font-medium border",
                      isCovered 
                        ? "bg-destructive/10 border-destructive/20 text-destructive"
                        : "bg-muted border-border/50 text-muted-foreground line-through opacity-50"
                    )}>
                      {isCovered ? <Ban className="h-3.5 w-3.5" /> : <div className="h-3.5 w-3.5" />}
                      {formatRedLine(redLine)}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Permissions */}
            <details className="rounded-md border border-border/50 bg-muted/20 p-3">
              <summary className="cursor-pointer text-xs font-medium uppercase tracking-widest text-muted-foreground" data-testid={`toggle-audit-intent-${task.id}`}>
                Audit details: complete intent and permissions
              </summary>
              <div className="mt-3 space-y-3">
                <div className="font-mono text-xs break-all">
                  <p><span className="text-muted-foreground">Task ID:</span> {task.id}</p>
                  <p><span className="text-muted-foreground">Action:</span> {task.action}</p>
                  <p><span className="text-muted-foreground">Resource:</span> {task.resource}</p>
                </div>
                <pre className="overflow-x-auto rounded-md border border-border/50 bg-background p-3 text-[11px] leading-relaxed text-muted-foreground">
                  {JSON.stringify(task.permissions, null, 2)}
                </pre>
              </div>
            </details>
          </div>

          {/* Context & Cryptographic Proof */}
          <div className="p-4 sm:p-6 md:col-span-5 space-y-6 bg-muted/10">
            
            <details className="space-y-4 rounded-md border border-border/50 p-3">
              <summary className="cursor-pointer text-xs font-medium uppercase tracking-widest text-muted-foreground" data-testid={`toggle-contract-${task.id}`}>
                <Lock className="mr-1 inline h-3.5 w-3.5" /> Contract details
              </summary>
              
              <div className="space-y-3 font-mono text-[11px]">
                <div className="flex justify-between items-center pb-2 border-b border-border/50">
                  <span className="text-muted-foreground">Environment</span>
                  <Badge variant="outline" className={cn(
                    "text-[10px] h-5",
                    task.environment === 'production' ? "bg-destructive/10 text-destructive border-destructive/20" : "bg-primary/10 text-primary border-primary/20"
                  )}>
                    {task.environment}
                  </Badge>
                </div>
                <div className="flex justify-between items-center pb-2 border-b border-border/50">
                  <span className="text-muted-foreground">Classification</span>
                  <span>{task.governanceClassification}</span>
                </div>
                <div className="flex flex-col gap-1 pb-2 border-b border-border/50">
                  <span className="text-muted-foreground">Contract Version</span>
                  <span className="truncate" title={task.contractVersion}>{task.contractVersion || 'N/A'}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-muted-foreground">Contract Hash</span>
                  <span className="truncate text-muted-foreground/70" title={task.contractHash}>{task.contractHash || 'N/A'}</span>
                </div>
              </div>
            </details>

            <Separator />

            {/* Audit Trail */}
            <div className="space-y-4">
              <h5 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-widest text-muted-foreground">
                <Fingerprint className="h-3.5 w-3.5" /> Audit Trail
              </h5>
              
              {isApproved ? (
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-md p-3 space-y-2">
                  <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" />
                    <span className="text-xs font-semibold uppercase tracking-wider">Approval Recorded</span>
                  </div>
                  <div className="font-mono text-[10px] space-y-1 break-all">
                    <p><span className="text-muted-foreground">By:</span> {task.ownerGovernanceApprovedBy}</p>
                    <p><span className="text-muted-foreground">At:</span> {task.ownerGovernanceApprovedAt ? formatTime(task.ownerGovernanceApprovedAt) : '-'}</p>
                    <p><span className="text-muted-foreground">Hash:</span> {task.ownerGovernanceApprovalHash}</p>
                  </div>
                </div>
              ) : (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-md p-3">
                   <p className="text-xs text-amber-600 dark:text-amber-500 flex items-start gap-2 leading-relaxed">
                     <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                      This check remains blocked until an independent Owner records approval.
                   </p>
                </div>
              )}

               {task.events && task.events.length > 0 && (
                <details className="space-y-2 mt-4">
                  <summary className="cursor-pointer text-[10px] uppercase tracking-widest text-muted-foreground" data-testid={`toggle-event-history-${task.id}`}>Full audit event history</summary>
                  <div className="space-y-2 max-h-32 overflow-y-auto pr-1">
                    {task.events.map((evt, idx) => (
                      <div key={evt.id || idx} className="text-[10px] font-mono border-l-2 border-border pl-2 py-0.5">
                        <div className="text-muted-foreground">{formatTime(evt.serverTimestamp)}</div>
                        <div className="font-medium text-foreground">{evt.eventType}</div>
                        <div className="truncate text-muted-foreground/50">{evt.eventHash}</div>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>

          </div>
        </div>
      </CardContent>

      {/* Footer / Approval Actions */}
      {!isApproved && isOwner && isSafeAcceptanceTask && (
        <CardFooter className="bg-muted/30 border-t border-border p-4 sm:p-6 flex justify-end">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="lg" className="gap-2" data-testid={`button-approve-${task.id}`}>
                <FileSignature className="h-4 w-4" />
                Review and approve
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2">
                  <Gavel className="h-5 w-5 text-primary" />
                   Confirm Owner approval
                </AlertDialogTitle>
                <AlertDialogDescription className="space-y-3 pt-2 text-foreground">
                   <p>You are acting as the independently verified <strong>Owner</strong>.</p>
                  <p className="text-sm bg-muted p-2 rounded border border-border font-mono">
                    Task: {task.id}<br/>
                    Action: {task.action}
                  </p>
                  <div className="bg-destructive/10 text-destructive p-3 rounded text-sm border border-destructive/20 flex gap-2">
                    <Ban className="h-5 w-5 shrink-0" />
                     <p>This records approval for this fixed Development safety check only. It does not grant production authority.</p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction 
                  onClick={() => onApprove(task.id)}
                  disabled={isApproving}
                  className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground"
                  data-testid={`button-confirm-approve-${task.id}`}
                >
                  <FileSignature className="h-4 w-4" />
                  {isApproving ? "Recording..." : "Confirm approval"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardFooter>
      )}
    </Card>
  );
}

function formatRole(role?: string) {
  if (!role) return 'Unknown';
  return role.replace('aiceo_', '').replace('_', ' ');
}

function formatRedLine(redLine: string) {
  return redLine.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export default function GovernanceAcceptanceWrapper() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect href="/sign-in" />;
  return <GovernanceAcceptancePage />;
}
