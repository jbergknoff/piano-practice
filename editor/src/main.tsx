import { render } from "preact";
import { Editor } from "./Editor";

const app = document.getElementById("app");
if (app) {
  render(<Editor />, app);
}
