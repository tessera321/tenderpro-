import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'TenderPro — тендерные закупки',
  description: 'Платформа для автоматизации тендерных КП',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  )
}
