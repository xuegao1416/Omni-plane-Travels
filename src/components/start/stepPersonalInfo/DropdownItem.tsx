import React from 'react';

/** Menu row inside a planar preset popover (`.ritual-menu-item`). */
export default function DropdownItem({ icon, label, disabled, onClick }: {
  icon: React.ReactNode; label: string; disabled?: boolean; onClick: () => void;
}) {
  return (
    <button type="button" className="ritual-menu-item" onClick={disabled ? undefined : onClick} disabled={disabled}>
      {icon} {label}
    </button>
  );
}
