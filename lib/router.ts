import { useLocation } from 'react-router'

export function usePathname() {
  return useLocation().pathname
}
