import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { TopBar } from '@/components/top-bar';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import './globals.css';

const sans = Geist({ variable: '--font-sans', subsets: ['latin'] });
const mono = Geist_Mono({ variable: '--font-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Rerun',
  description:
    'Diagnoses failed HCP Terraform runs through the Terraform MCP server and proposes verified fixes.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`dark ${sans.variable} ${mono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <TooltipProvider delayDuration={200}>
          <TopBar />
          <div className="flex flex-1 flex-col">{children}</div>
        </TooltipProvider>
        <Toaster theme="dark" position="bottom-right" />
      </body>
    </html>
  );
}
