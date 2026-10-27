import Link from "next/link";
import Image from "next/image";
export function Shell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return <><header className="app-header"><Link className="brand" href="/" aria-label="DialIt home"><Image className="brand-logo" src="/dial-it-logo.svg" alt="DIAL IT" width={2172} height={724} priority /></Link><nav><Link href="/join">Join a session</Link><Link href="/">Projects</Link></nav></header><main className={wide ? "wide" : ""}>{children}</main><footer className="app-footer"><div className="footer-inner"><div className="footer-company"><span className="footer-accent" aria-hidden="true" /><strong>Beacon Consulting Pte Ltd</strong></div><address className="footer-contacts"><a href="https://www.beacon.com.sg">www.beacon.com.sg</a><a href="tel:+6568739768">Tel: 6873 9768</a><a href="mailto:customercare@beacon.com.sg">customercare@beacon.com.sg</a></address></div></footer></>;
}
