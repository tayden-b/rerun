import Link from 'next/link';
import { config } from '@/src/config';
import { Badge } from '@/components/ui/badge';

export function TopBar() {
  return (
    <header className="bg-background/80 sticky top-0 z-20 border-b backdrop-blur">
      <div className="mx-auto flex h-12 w-full max-w-6xl items-center gap-3 px-6">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <RerunMark />
          Rerun
        </Link>
        <span className="text-border" aria-hidden="true">
          /
        </span>
        <span className="text-muted-foreground font-mono text-xs" data-testid="workspace">
          {config.workspace}
        </span>
        <nav className="ml-auto flex items-center gap-4 text-sm">
          <Link
            href="/"
            className="text-muted-foreground hover:text-foreground transition-colors duration-150"
          >
            Incidents
          </Link>
          <Link
            href="/about"
            className="text-muted-foreground hover:text-foreground transition-colors duration-150"
          >
            About
          </Link>
        </nav>
        <Badge variant="outline" className="text-muted-foreground font-mono" data-testid="mode-badge">
          {config.mode}
        </Badge>
      </div>
    </header>
  );
}

function RerunMark() {
  return (
    <svg viewBox="0 0 16 16" className="text-brand size-4" fill="none" aria-hidden="true">
      <path
        d="M13 8a5 5 0 1 1-1.46-3.54M13 2.5V5h-2.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
