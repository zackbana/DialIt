"use client";
import { useParams } from "next/navigation";
import { Moderator } from "../../../components/Moderator";
export default function Page() { const { sessionId } = useParams<{ sessionId: string }>(); return <Moderator sessionId={sessionId} />; }
