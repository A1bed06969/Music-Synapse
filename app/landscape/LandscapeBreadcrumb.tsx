import Link from 'next/link'

export type BreadcrumbStep = { name: string; href: string }

export default function LandscapeBreadcrumb({ steps }: { steps: BreadcrumbStep[] }) {
  return (
    <nav className="flex flex-wrap items-center gap-1.5 text-sm text-white/50">
      {steps.map((step, i) => (
        <span key={step.href} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-white/20">/</span>}
          {i === steps.length - 1 ? (
            <span className="font-medium text-white">{step.name}</span>
          ) : (
            <Link href={step.href} className="hover:text-white/80">
              {step.name}
            </Link>
          )}
        </span>
      ))}
    </nav>
  )
}
