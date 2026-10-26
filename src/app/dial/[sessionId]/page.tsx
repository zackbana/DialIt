"use client";
import { useParams } from "next/navigation";
import { Dial } from "../../../components/Dial";
export default function Page() { const { sessionId } = useParams<{ sessionId: string }>(); return <Dial sessionId={sessionId} />; }
