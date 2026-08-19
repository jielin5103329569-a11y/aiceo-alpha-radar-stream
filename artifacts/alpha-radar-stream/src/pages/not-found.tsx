export default function NotFound() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-background p-4">
      <div className="text-center max-w-sm">
        <h1 className="text-4xl font-bold mb-2">404</h1>
        <p className="text-muted-foreground mb-6">Page not found</p>
        <button 
          onClick={() => window.history.back()}
          className="text-sm border rounded-md px-4 py-2 hover:bg-muted transition-colors"
        >
          Go Back
        </button>
      </div>
    </div>
  );
}
