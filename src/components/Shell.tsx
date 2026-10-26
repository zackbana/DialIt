import Link from "next/link";
export function Shell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return <><header className="app-header"><Link className="brand" href="/">DialIt<span> / Beacon Consulting</span></Link><nav><Link href="/join">Join a session</Link><Link href="/">Projects</Link></nav></header><main className={wide ? "wide" : ""}>{children}</main><footer>Beacon Consulting · Dial-testing pilot · Rehearse on your actual tablets before research use.</footer></>;
}
