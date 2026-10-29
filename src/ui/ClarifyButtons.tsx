import type { ClarifyAnswer } from "../core/attributes.ts";
export function ClarifyButtons({ onAnswer }: { onAnswer: (answer: ClarifyAnswer) => void }) {
  return <div className="button-row clarify-options"><button className="primary" onClick={() => onAnswer("yes")}>Yes</button>
    <button className="secondary" onClick={() => onAnswer("no")}>No</button>
    <button className="text-button" onClick={() => onAnswer("not_sure")}>Not sure</button></div>;
}
