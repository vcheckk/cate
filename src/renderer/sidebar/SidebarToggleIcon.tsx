import React from 'react'

// Custom sidebar toggle icon — like lucide PanelLeftClose/Open, but the inner
// divider is inset 2px from the panel border on each end so the stroke joins
// don't create bright dots where the divider meets the rounded rectangle.
interface Props {
  size?: number
  direction: 'open' | 'close'
}

export const SidebarToggleIcon: React.FC<Props> = ({ size = 16, direction }) => {
  // Chevron points right when collapsed (open), left when expanded (close)
  const chevron = direction === 'open' ? 'm14 9 3 3-3 3' : 'm16 15-3-3 3-3'
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="18" height="18" x="3" y="3" rx="2" />
      {/* Inner divider — inset 2px on top and bottom to avoid corner overlap */}
      <path d="M9 5v14" />
      <path d={chevron} />
    </svg>
  )
}
