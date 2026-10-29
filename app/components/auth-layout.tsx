import type { ReactNode } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "~/ui/card"

export const authInputClass =
  "h-9 rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none focus:ring-2 focus:ring-ring"

/** Card on top of the blurred library photo, shared by the auth pages. */
export function AuthLayout({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      {/* Full-page library photo, blurred; scaled up so the blur doesn't fade the edges */}
      <div
        aria-hidden
        className="absolute inset-0 scale-110 bg-cover bg-center blur-sm"
        style={{
          backgroundImage: `url(${import.meta.env.BASE_URL}login-bg.jpg)`,
        }}
      />
      <div aria-hidden className="absolute inset-0 bg-black/20" />

      <Card className="relative w-full max-w-sm shadow-xl">
        <CardHeader>
          <CardTitle className="text-2xl">{title}</CardTitle>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  )
}
