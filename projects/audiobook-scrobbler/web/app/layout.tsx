import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Audiobook Scrobbler',
  description: 'Listening log for audiobooks',
  manifest: '/manifest.json',
};
export const viewport: Viewport = { themeColor: '#0f1115' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav>
          <a href="/">Now</a>
          <a href="/settings">Settings</a>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
