"use client";
import { useParams } from "next/navigation";
import { Dashboard } from "../../../components/Dashboard";
export default function Page() { const { sessionId } = useParams<{ sessionId: string }>(); return <Dashboard sessionId={sessionId} />; }
