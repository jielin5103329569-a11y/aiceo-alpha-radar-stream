import { AutonomousOperationsCoordinator } from "./autonomousOperationsCoordinator";
import { AutonomousOperationsStore } from "./autonomousOperationsStore";

/** The sole API-process coordinator instance; it owns no listener or workflow. */
export const autonomousOperationsCoordinator = new AutonomousOperationsCoordinator(
  new AutonomousOperationsStore(),
);