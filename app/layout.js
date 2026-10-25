import './globals.css';

export const metadata = {
  title: 'PATCHGUARD · Dependency security',
  description: 'A clear path from repository vulnerabilities to tested, reviewed dependency patches.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
