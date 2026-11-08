import { Link } from '@tanstack/react-router'

export function AuthLogo() {
  return (
    <Link to="/" aria-label="Go home" className="flex items-center gap-2">
      <svg
        className="h-6 w-6 text-foreground"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        role="img"
        aria-labelledby="auth-logo-title"
      >
        <title id="auth-logo-title">Pi Control Center logo</title>
        <rect width="16" height="16" x="4" y="4" rx="2" />
        <rect width="6" height="6" x="9" y="9" rx="1" />
        <path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2" />
      </svg>
      <span className="text-base font-semibold">Pi Control Center</span>
    </Link>
  )
}
