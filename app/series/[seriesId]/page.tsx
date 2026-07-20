import { redirect } from "next/navigation";

export default async function SeriesIndex({
  params,
}: {
  params: Promise<{ seriesId: string }>;
}) {
  const { seriesId } = await params;
  redirect(`/series/${seriesId}/cards`);
}
