import { requireUser } from "@/lib/auth-helpers";
import { createSeriesAction } from "@/app/actions/series";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export default async function NewSeriesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireUser();
  const { error } = await searchParams;
  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="mb-4 text-3xl">New series</h1>
      <Panel>
        {error && <p className="mb-2 text-sm text-danger">{error}</p>}
        <form action={createSeriesAction} className="space-y-3">
          <div>
            <Label htmlFor="title">Series title</Label>
            <Input id="title" name="title" required maxLength={200} placeholder="The Vale Cycle" />
          </div>
          <div>
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea id="description" name="description" maxLength={2000} />
          </div>
          <Button type="submit">Create series</Button>
        </form>
      </Panel>
      <p className="mt-3 text-xs text-soft">
        Default card templates for all seven types are created automatically. You&apos;ll add books
        and sections next.
      </p>
    </main>
  );
}
