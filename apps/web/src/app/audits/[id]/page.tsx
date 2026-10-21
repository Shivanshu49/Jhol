import { AuditReport } from "./audit-report";

export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AuditReport id={id} />;
}
