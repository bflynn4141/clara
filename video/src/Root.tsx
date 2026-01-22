import { Composition } from "remotion";
import { ClaraExplainer } from "./ClaraExplainer";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="ClaraExplainer"
        component={ClaraExplainer}
        durationInFrames={450} // 15 seconds at 30fps
        fps={30}
        width={1080}
        height={1080}
      />
    </>
  );
};
