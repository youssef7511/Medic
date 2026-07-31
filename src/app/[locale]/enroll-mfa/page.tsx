import { EnrollMfaForm } from './EnrollMfaForm';

export const dynamic = 'force-dynamic';

export default function EnrollMfaPage() {
  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="text-2xl font-bold">Set up two-factor authentication</h1>
      <div className="mt-8">
        <EnrollMfaForm />
      </div>
    </div>
  );
}
