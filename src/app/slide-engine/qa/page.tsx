import { SlideEngineQaFixture } from "@/components/SlideEngineQaFixture";
import { demoLecture } from "@/lib/demo-data";

export default function SlideEngineQaPage() {
  return <SlideEngineQaFixture slides={demoLecture.slides} />;
}
