import { SlideEngineEditorFixture } from "@/components/SlideEngineEditorFixture";
import { allBlockTypesSlideDocument } from "@learnordie/slide-engine/fixtures";

export default async function SlideEngineEditorQaPage({
  searchParams
}: {
  searchParams?: Promise<{ slide?: string }>;
}) {
  const params = await searchParams;
  return (
    <SlideEngineEditorFixture
      document={allBlockTypesSlideDocument}
      initialSlideId={params?.slide}
    />
  );
}
