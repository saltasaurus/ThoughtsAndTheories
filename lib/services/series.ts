import { prisma } from "@/lib/db";
import { DEFAULT_TEMPLATES } from "@/lib/templates";

/** Create a series with its OWNER membership and default templates for all seven card types. */
export async function createSeries(
  userId: string,
  input: { title: string; description?: string },
): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const series = await tx.series.create({
      data: { title: input.title, description: input.description ?? null },
    });
    await tx.membership.create({
      data: {
        userId,
        seriesId: series.id,
        role: "OWNER",
        currentSectionId: null,
        revealIndex: 0,
      },
    });
    for (const [cardType, fields] of Object.entries(DEFAULT_TEMPLATES)) {
      await tx.template.create({
        data: {
          seriesId: series.id,
          cardType: cardType as keyof typeof DEFAULT_TEMPLATES,
          fields: {
            create: fields.map((f, i) => ({
              key: f.key,
              label: f.label,
              fieldType: f.fieldType,
              options: f.options,
              required: f.required ?? false,
              order: i + 1,
            })),
          },
        },
      });
    }
    return series.id;
  });
}

export async function listSeriesForUser(
  userId: string,
): Promise<Array<{ id: string; title: string; role: string }>> {
  const memberships = await prisma.membership.findMany({
    where: { userId },
    include: { series: { select: { id: true, title: true } } },
    orderBy: { createdAt: "asc" },
  });
  return memberships.map((m) => ({ id: m.series.id, title: m.series.title, role: m.role }));
}
