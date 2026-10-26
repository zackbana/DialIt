"use client";
import { useParams } from "next/navigation";
import { Display } from "../../../components/Display";
export default function Page() { const { sessionId } = useParams<{ sessionId: string }>(); return <Display sessionId={sessionId} />; }
