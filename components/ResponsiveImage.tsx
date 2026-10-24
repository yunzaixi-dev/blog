import { cn } from '@/lib/utils'

type ResponsiveImageProps = {
  src: string
  alt: string
  sizes?: string
  className?: string
  priority?: boolean
  fill?: boolean
  width?: number
  height?: number
}
export default function ResponsiveImage({
  src,
  alt,
  sizes,
  className,
  priority = false,
  fill = false,
  width,
  height,
}: ResponsiveImageProps) {
  return (
    <img
      src={src}
      alt={alt}
      sizes={sizes}
      width={width}
      height={height}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : 'auto'}
      decoding="async"
      className={cn(fill && 'h-full w-full object-cover', className)}
    />
  )
}
