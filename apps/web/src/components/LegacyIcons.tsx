"use client";

/**
 * LegacyIcons — faithful SVG icons & brand graphics recreating eRun POSGV3.3 (POS330G.exe).
 */

export function HarpCentreLogo({
  compact = false,
  showHotline = false,
}: {
  compact?: boolean;
  showHotline?: boolean;
}) {
  if (compact) {
    return (
      <div className="flex flex-col items-center justify-center text-black">
        <div className="flex items-center gap-1">
          <svg className="h-9 w-9" viewBox="0 0 80 100" aria-hidden="true">
            <path
              d="M22 10 C32 22, 42 36, 48 34 C54 32, 60 20, 62 12 C60 30, 56 44, 48 52 C38 62, 26 76, 14 90 C24 72, 34 56, 36 42 C38 28, 28 18, 16 12 Z"
              fill="#111"
            />
            <path
              d="M24 14 C34 26, 42 40, 40 52 C37 64, 24 78, 12 92"
              fill="none"
              stroke="#111"
              strokeWidth="2.5"
            />
          </svg>
          <div className="text-left leading-none">
            <div className="text-[7px] tracking-[0.22em] text-[#555]">HONG KONG</div>
            <div className="font-serif text-[10px] tracking-[0.1em] text-[#444]">HARP CENTRE</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center select-none text-black">
      <div className="flex items-center gap-3">
        <svg className="h-36 w-28 shrink-0" viewBox="0 0 110 140" aria-hidden="true">
          <path
            d="M20 12 C34 28, 48 48, 60 44 C72 40, 84 22, 92 10 C86 38, 76 62, 60 76 C44 90, 26 112, 12 130 C28 104, 42 82, 44 60 C46 40, 32 24, 14 14 Z"
            fill="#141414"
          />
          <path
            d="M26 18 C38 34, 48 52, 46 68 C43 86, 26 106, 10 128"
            fill="none"
            stroke="#141414"
            strokeWidth="3.2"
          />
          <path
            d="M34 26 C44 40, 52 54, 52 68"
            fill="none"
            stroke="#141414"
            strokeWidth="1.6"
          />
        </svg>
        <div className="text-left">
          <div className="text-[14px] tracking-[0.22em] text-[#222]">HONG KONG</div>
          <div className="font-serif text-[26px] tracking-[0.14em] text-[#111] leading-tight">
            HARP CENTRE
          </div>
        </div>
      </div>
      {showHotline ? (
        <div className="mt-4 text-center text-[#111]">
          <div className="text-[16px] tracking-[0.08em]">eRUN SUPPORT HOTLINE :</div>
          <div className="mt-1 text-[20px] font-medium tracking-[0.16em]">51 888 902</div>
        </div>
      ) : null}
    </div>
  );
}

export function ERunWordmark() {
  return (
    <div className="flex flex-col items-end leading-none select-none">
      <div className="text-[17px] font-bold italic tracking-tight text-[#1289c7]">eRun</div>
      <div className="mt-0.5 text-[8px] font-semibold tracking-wider text-[#2e7ec2]">POSGV3.3</div>
    </div>
  );
}

export function ERunAboutBadge() {
  return (
    <svg className="h-14 w-14 shrink-0" viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="erunBadgeGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3c7cf0" />
          <stop offset="100%" stopColor="#1646a6" />
        </linearGradient>
      </defs>
      <rect x="4" y="8" width="56" height="52" rx="10" fill="url(#erunBadgeGrad)" stroke="#0f2c6d" strokeWidth="2" />
      <rect x="2" y="2" width="38" height="16" rx="4" fill="#132c68" stroke="#6ea2f8" strokeWidth="1.5" />
      <text x="21" y="13" textAnchor="middle" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="Tahoma, sans-serif">
        erun
      </text>
      <path d="M18 26h6l4 16h18l4-11H26" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="31" cy="48" r="3" fill="#fff" />
      <circle cx="44" cy="48" r="3" fill="#fff" />
    </svg>
  );
}

export function LegacyIcon({ name, className = "h-5 w-5" }: { name: string; className?: string }) {
  switch (name) {
    case "logout":
      return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9.5" fill="#d9534f" stroke="#9b2c2a" strokeWidth="1.2" />
          <path d="M12 6v6M8.5 8.5a5 5 0 1 0 7 0" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      );
    case "billQuery":
      return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="3" width="12" height="16" rx="1" fill="#fff" stroke="#4a6fa5" strokeWidth="1.5" />
          <path d="M7 7h6M7 10h6M7 13h4" stroke="#2e7ec2" strokeWidth="1.5" />
          <circle cx="16.5" cy="15.5" r="3.5" fill="#d9ecff" stroke="#1b4d89" strokeWidth="1.5" />
          <path d="M19 18l2.5 2.5" stroke="#1b4d89" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case "stock":
      return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 8l8-4 8 4v9l-8 4-8-4z" fill="#e0a952" stroke="#8a5a19" strokeWidth="1.3" />
          <path d="M4 8l8 4 8-4M12 12v9" fill="none" stroke="#8a5a19" strokeWidth="1.3" />
        </svg>
      );
    case "retail":
      return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
          <rect x="5" y="4" width="14" height="5" rx="1" fill="#f7fbff" stroke="#3b6e9c" strokeWidth="1.4" />
          <path d="M4 11h16l1 8H3z" fill="#6aa5d9" stroke="#28507a" strokeWidth="1.3" />
          <rect x="6" y="13" width="12" height="4" fill="#fff" />
        </svg>
      );
    case "otherTxn":
      return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
          <rect x="2" y="7" width="13" height="9" rx="1" fill="#5da0df" stroke="#1c4c7d" strokeWidth="1.2" />
          <path d="M15 9h4l3 3v4h-7z" fill="#9cc8f0" stroke="#1c4c7d" strokeWidth="1.2" />
          <circle cx="7" cy="18" r="2.2" fill="#444" />
          <circle cx="18" cy="18" r="2.2" fill="#444" />
        </svg>
      );
    case "cashier":
      return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
          <ellipse cx="12" cy="17" rx="7" ry="2.5" fill="#d9a441" stroke="#8c6216" strokeWidth="1.1" />
          <ellipse cx="12" cy="13.5" rx="7" ry="2.5" fill="#f0c45c" stroke="#8c6216" strokeWidth="1.1" />
          <ellipse cx="12" cy="10" rx="7" ry="2.5" fill="#f8d878" stroke="#8c6216" strokeWidth="1.1" />
          <ellipse cx="12" cy="6.5" rx="7" ry="2.5" fill="#ffe48f" stroke="#8c6216" strokeWidth="1.1" />
        </svg>
      );
    case "manager":
      return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="7" r="3.8" fill="#d88f5c" stroke="#78421b" strokeWidth="1.2" />
          <path d="M5 20c0-4 3-6.5 7-6.5s7 2.5 7 6.5z" fill="#555" stroke="#222" strokeWidth="1.2" />
          <path d="M10.5 13.5l1.5 4.5 1.5-4.5z" fill="#d9534f" />
        </svg>
      );
    case "bdata":
      return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 19V5M4 19h16" stroke="#444" strokeWidth="1.5" />
          <path d="M6 16l4-6 4 3 5-7" fill="none" stroke="#2e7ec2" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="10" cy="10" r="1.5" fill="#2e7ec2" />
          <circle cx="14" cy="13" r="1.5" fill="#2e7ec2" />
          <circle cx="19" cy="6" r="1.5" fill="#d9534f" />
        </svg>
      );
    case "support":
      return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9.5" fill="#3a87d6" stroke="#1d4f8a" strokeWidth="1.2" />
          <path d="M9.5 9.2a2.7 2.7 0 0 1 5.1 1.2c0 1.6-2.2 2-2.2 3.5" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="12.3" cy="17.3" r="1.2" fill="#fff" />
        </svg>
      );
    case "buttons":
      return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
          {[4, 10, 16].map((y) =>
            [4, 10, 16].map((x) => (
              <rect key={`${x}-${y}`} x={x} y={y} width="4" height="4" rx="0.6" fill="#2b6cc4" />
            )),
          )}
        </svg>
      );
    case "info":
      return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
          <rect x="5" y="4" width="14" height="17" rx="1.5" fill="#f7dca4" stroke="#8a6424" strokeWidth="1.3" />
          <rect x="8.5" y="2.5" width="7" height="3" rx="0.8" fill="#999" stroke="#555" strokeWidth="1" />
          <path d="M8 10h8M8 13.5h8M8 17h5" stroke="#5a431a" strokeWidth="1.4" />
        </svg>
      );
    case "exit":
      return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
          <rect x="9" y="3" width="11" height="18" rx="1" fill="#3b78b8" stroke="#1e4873" strokeWidth="1.2" />
          <path d="M3 12h9M8 8l4 4-4 4" fill="none" stroke="#1e4873" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "back":
      return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="4" width="16" height="16" rx="2" fill="#e6a23c" stroke="#996314" strokeWidth="1.2" />
          <path d="M16 12H8M11 8.5L7.5 12 11 15.5" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "image":
      return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="1.5" fill="#cbe5ff" stroke="#366da8" strokeWidth="1.3" />
          <circle cx="8.5" cy="9.5" r="2" fill="#fff" />
          <path d="M4 17l5-5 4 4 3-3 4 4v2H4z" fill="#3a87d6" />
        </svg>
      );
    case "promo":
      return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 12l8.5-8.5H20v8.5L11.5 20.5z" fill="#e05347" stroke="#8f241b" strokeWidth="1.2" />
          <circle cx="16" cy="7.5" r="1.4" fill="#fff" />
          <text x="10.5" y="15" textAnchor="middle" fill="#fff" fontSize="8" fontWeight="bold">
            %
          </text>
        </svg>
      );
    case "products":
      return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 8l8-4 8 4v9l-8 4-8-4z" fill="#d9a148" stroke="#7d5318" strokeWidth="1.2" />
          <path d="M4 8l8 4 8-4M12 12v9" fill="none" stroke="#7d5318" strokeWidth="1.2" />
        </svg>
      );
    case "members":
      return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="9" cy="8" r="3.2" fill="#4f8cd4" />
          <path d="M3.5 19c0-3.2 2.4-5.2 5.5-5.2s5.5 2 5.5 5.2z" fill="#4f8cd4" />
          <circle cx="16" cy="9" r="2.6" fill="#2962a8" />
          <path d="M13.5 19c0-2.5 1.7-4.2 4.2-4.2 2 0 3.3 1.4 3.3 4.2z" fill="#2962a8" />
        </svg>
      );
    case "staff":
      return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="7.5" r="3.5" fill="#7c8b99" />
          <path d="M5.5 20c0-3.6 2.8-6 6.5-6s6.5 2.4 6.5 6z" fill="#5e6b78" />
        </svg>
      );
    case "barcode":
      return (
        <svg className={className} viewBox="0 0 28 18" aria-hidden="true">
          <rect x="1" y="1" width="26" height="16" fill="#fff" stroke="#777" strokeWidth="1" />
          <path
            d="M4 3v12M6 3v12M7.5 3v12M10 3v12M12 3v12M13.5 3v12M16 3v12M18 3v12M20.5 3v12M22.5 3v12M24 3v12"
            stroke="#111"
            strokeWidth="1.2"
          />
        </svg>
      );
    case "delivery":
      return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 6h3l2.5 9h10l2-6H8" fill="none" stroke="#555" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="9.5" y="4" width="6.5" height="5.5" fill="#e0a952" stroke="#8a5a19" strokeWidth="1" />
          <circle cx="10" cy="18.5" r="1.8" fill="#444" />
          <circle cx="17.5" cy="18.5" r="1.8" fill="#444" />
        </svg>
      );
    case "itemDisc":
      return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 8l7-4 7 4v8l-7 4-7-4z" fill="#d9a148" stroke="#7d5318" strokeWidth="1.1" />
          <circle cx="17" cy="16" r="5" fill="#d9534f" />
          <text x="17" y="18.8" textAnchor="middle" fill="#fff" fontSize="8" fontWeight="bold">
            %
          </text>
        </svg>
      );
    case "billDisc":
      return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="3" width="12" height="16" fill="#fff" stroke="#3b6e9c" strokeWidth="1.2" />
          <path d="M6.5 7h7M6.5 10h7M6.5 13h4" stroke="#3b6e9c" strokeWidth="1.2" />
          <circle cx="17" cy="16" r="5" fill="#d9534f" />
          <text x="17" y="18.8" textAnchor="middle" fill="#fff" fontSize="8" fontWeight="bold">
            %
          </text>
        </svg>
      );
    case "upArrow":
      return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 4l-7 7h4.5v8h5v-8H19z" fill="#3a87d6" stroke="#1b4d89" strokeWidth="1" />
        </svg>
      );
    case "downArrow":
      return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 20l7-7h-4.5V5h-5v8H5z" fill="#3a87d6" stroke="#1b4d89" strokeWidth="1" />
        </svg>
      );
    case "print":
      return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
          <rect x="6" y="3" width="12" height="6" fill="#fff" stroke="#555" strokeWidth="1.2" />
          <rect x="3" y="8" width="18" height="9" rx="1.5" fill="#a8b4c2" stroke="#444" strokeWidth="1.2" />
          <rect x="6" y="13" width="12" height="8" fill="#fff" stroke="#555" strokeWidth="1.2" />
          <path d="M8 16h8M8 18.5h6" stroke="#2e7ec2" strokeWidth="1.2" />
        </svg>
      );
    case "excel":
      return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="3" width="16" height="18" rx="1.5" fill="#fff" stroke="#2d7a47" strokeWidth="1.5" />
          <text x="12" y="16" textAnchor="middle" fill="#2d7a47" fontSize="12" fontWeight="bold">
            X
          </text>
        </svg>
      );
    case "check":
      return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 13l4.5 4.5L19 7.5" fill="none" stroke="#43a047" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "cross":
      return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" stroke="#d9534f" strokeWidth="3.2" strokeLinecap="round" />
        </svg>
      );
    case "calendar":
      return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="4" width="18" height="17" rx="1.5" fill="#fff" stroke="#555" strokeWidth="1.2" />
          <rect x="3" y="4" width="18" height="5" fill="#d9534f" />
          <text x="12" y="17.5" textAnchor="middle" fill="#333" fontSize="9" fontWeight="bold">
            23
          </text>
        </svg>
      );
    default:
      return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="4" width="16" height="16" rx="2" fill="#d8e3f0" stroke="#5b7aa1" strokeWidth="1.4" />
          <path d="M8 9h8M8 12.5h8M8 16h5" stroke="#2e5888" strokeWidth="1.4" />
        </svg>
      );
  }
}
