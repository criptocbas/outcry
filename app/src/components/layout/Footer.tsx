export default function Footer() {
  return (
    <footer className="relative mt-24 border-t border-gold/10">
      {/* Gradient fade from content to footer */}
      <div className="absolute -top-24 left-0 right-0 h-24 bg-gradient-to-b from-transparent to-jet pointer-events-none" />

      <div className="mx-auto max-w-7xl px-6 py-12">
        {/* Hackathon attribution */}
        <div className="flex flex-col items-center gap-6 text-center">
          <p className="font-sans text-[11px] tracking-[0.25em] text-cream/30 uppercase">
            Built for the
          </p>
          <a
            href="https://solana.com/graveyard-hack"
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center gap-2 transition-colors duration-300"
          >
            <span className="font-serif text-lg font-semibold italic text-cream/50 transition-colors duration-300 group-hover:text-gold">
              Solana Graveyard Hackathon
            </span>
            <svg
              className="h-3.5 w-3.5 text-cream/30 transition-all duration-300 group-hover:text-gold group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M7 17L17 7M17 7H7M17 7v10"
              />
            </svg>
          </a>

          {/* Divider */}
          <div className="flex items-center gap-4">
            <div className="h-px w-12 bg-gradient-to-r from-transparent to-gold/20" />
            <span className="font-sans text-[10px] tracking-[0.3em] text-cream/20 uppercase select-none">
              Powered by
            </span>
            <div className="h-px w-12 bg-gradient-to-l from-transparent to-gold/20" />
          </div>

          {/* Technology links */}
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            <TechLink href="https://magicblock.gg" label="MagicBlock" />
            <TechSep />
            <TechLink href="https://solana.com" label="Solana" />
            <TechSep />
            <TechLink href="https://exchange.art" label="Exchange Art" />
            <TechSep />
            <TechLink href="https://usetapestry.dev" label="Tapestry" />
            <TechSep />
            <TechLink href="https://drip.haus" label="DRiP" />
            <TechSep />
            <TechLink href="https://metaplex.com" label="Metaplex" />
          </div>

          {/* Bottom tagline */}
          <p className="mt-4 font-serif text-xs italic text-cream/15">
            Going, going, onchain.
          </p>
        </div>
      </div>
    </footer>
  );
}

function TechLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-sans text-[11px] tracking-[0.15em] text-cream/40 uppercase transition-colors duration-200 hover:text-gold"
    >
      {label}
    </a>
  );
}

function TechSep() {
  return (
    <span className="text-[8px] text-gold/20 select-none">&middot;</span>
  );
}
