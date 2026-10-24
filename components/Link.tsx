/* eslint-disable jsx-a11y/anchor-has-content */
import { AnchorHTMLAttributes } from 'react'
import { Link } from 'react-router'
import { cn } from '@/lib/utils'

function isStaticAssetPath(href: string) {
  return (
    href === '/feed.xml' ||
    href === '/robots.txt' ||
    href === '/sitemap.xml' ||
    href.startsWith('/static/') ||
    href.startsWith('/assets/') ||
    href.startsWith('/export/') ||
    /\.[a-z0-9]+(?:[?#]|$)/i.test(href)
  )
}

const CustomLink = ({
  className,
  href = '',
  replace,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { replace?: boolean }) => {
  const isInternalLink = href && href.startsWith('/')
  const isAnchorLink = href && href.startsWith('#')
  const linkClassName = cn('break-words', className)

  if (isInternalLink && !href.startsWith('//') && !rest.download && !isStaticAssetPath(href)) {
    return <Link className={linkClassName} to={href} replace={replace} {...rest} />
  }

  if (isInternalLink || isAnchorLink) {
    return <a className={linkClassName} href={href} {...rest} />
  }

  return (
    <a className={linkClassName} target="_blank" rel="noopener noreferrer" href={href} {...rest} />
  )
}

export default CustomLink
