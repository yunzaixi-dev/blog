import { getIconComponent, toIconComponentName } from '@/lib/icons'
import type { LucideProps } from 'lucide-react'
import { useEffect, useState } from 'react'
import { generatedLucideIcons } from '@/lib/generated/lucide-icons'
import { normalizeIconKey } from '@/lib/iconName'

type IconProps = Omit<LucideProps, 'ref'> & {
  decorative?: boolean
  inlineSpacing?: boolean
  label?: string
  name: string
}

export default function Icon({
  name,
  label,
  decorative = !label,
  inlineSpacing = true,
  className = '',
  size = 16,
  strokeWidth = 2,
  ...props
}: IconProps) {
  const componentName = toIconComponentName(name)
  const [loaded, setLoaded] = useState<{
    name: string
    component: ReturnType<typeof getIconComponent>
  } | null>(null)
  useEffect(() => {
    if (generatedLucideIcons[componentName]) return
    let cancelled = false
    import('lucide-react/dynamicIconImports')
      .then(async ({ default: imports }) => {
        const key = normalizeIconKey(componentName) as keyof typeof imports
        if (!imports[key]) throw new Error(`Unknown icon ${name}`)
        const module = await imports[key]()
        if (!cancelled) setLoaded({ name: componentName, component: module.default })
      })
      .catch((error: unknown) => {
        if (!cancelled) console.error(error)
      })
    return () => {
      cancelled = true
    }
  }, [componentName, name])
  const IconComponent = loaded?.name === componentName ? loaded.component : getIconComponent(name)

  return (
    <IconComponent
      aria-hidden={decorative ? 'true' : undefined}
      aria-label={!decorative ? label || componentName : undefined}
      className={`inline-block shrink-0 align-[-0.125em] ${inlineSpacing ? 'mx-1' : ''} ${className}`}
      focusable="false"
      size={size}
      strokeWidth={strokeWidth}
      {...props}
    />
  )
}
