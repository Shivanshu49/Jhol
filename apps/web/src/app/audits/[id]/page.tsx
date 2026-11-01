import { AuditReport } from "./audit-report";

export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="mx-auto w-full max-w-4xl">
      <AuditReport id={id} />
    </div>
  );
}
