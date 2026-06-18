import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Tell React it's running in a test "act" environment so state updates triggered
// outside fireEvent (e.g. store calls wrapped in act()) are handled correctly.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

afterEach(cleanup);
