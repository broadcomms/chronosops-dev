/**
 * Architecture design types for self-regenerating app ecosystem
 */

/**
 * Component type classification
 */
export type ComponentType =
  | 'service'
  | 'repository'
  | 'controller'
  | 'middleware'
  | 'route'
  | 'model'
  | 'util'
  | 'component'
  | 'hook'
  | 'context';

/**
 * Dependency relationship type
 */
export type DependencyType = 'uses' | 'extends' | 'implements' | 'imports';

/**
 * Architecture design for a feature
 */
export interface ArchitectureDesign {
  /** High-level description of the architecture */
  overview: string;

  /** Components to be created or modified */
  components: ComponentSpec[];

  /** Dependencies between components */
  dependencies: DependencySpec[];

  /** External dependencies (npm packages) */
  externalDependencies: ExternalDependency[];

  /** Data flow description */
  dataFlow: string;

  /** Security considerations */
  securityConsiderations: string[];

  /** Performance considerations */
  performanceConsiderations: string[];

  /** Testing strategy */
  testingStrategy?: string;

  /** Thought signature for continuity */
  thoughtSignature?: string;
}

/**
 * Specification for a single component
 */
export interface ComponentSpec {
  /** Name of the component */
  name: string;

  /** Type of component */
  type: ComponentType;

  /** Purpose and responsibility */
  purpose: string;

  /** Suggested file path (relative to project root) */
  suggestedPath: string;

  /** Public interface methods */
  interface: InterfaceMethod[];

  /** Internal state if any */
  internalState?: string[];

  /** Error handling approach */
  errorHandling: string;

  /** Dependencies on other components */
  dependsOn?: string[];

  /** Test requirements */
  testRequirements?: string[];
}

/**
 * Method in a component interface
 */
export interface InterfaceMethod {
  /** Method name */
  name: string;

  /** Description of what the method does */
  description: string;

  /** Method parameters */
  parameters: ParameterSpec[];

  /** Return type */
  returnType: string;

  /** Whether the method is async */
  async: boolean;

  /** Throws errors? */
  throws?: string[];
}

/**
 * Parameter specification
 */
export interface ParameterSpec {
  /** Parameter name */
  name: string;

  /** TypeScript type */
  type: string;

  /** Whether the parameter is optional */
  optional: boolean;

  /** Description of the parameter */
  description: string;

  /** Default value if any */
  defaultValue?: string;
}

/**
 * Dependency between components
 */
export interface DependencySpec {
  /** Source component name */
  from: string;

  /** Target component name */
  to: string;

  /** Type of dependency */
  type: DependencyType;

  /** Description of the relationship */
  description?: string;
}

/**
 * External npm dependency
 */
export interface ExternalDependency {
  /** Package name */
  name: string;

  /** Version (semver) */
  version: string;

  /** Purpose of the dependency */
  purpose: string;

  /** Whether it's a dev dependency */
  devOnly: boolean;
}

/**
 * Request to design architecture
 */
export interface ArchitectureDesignRequest {
  /** Analyzed requirement */
  requirement: import('./requirement.js').AnalyzedRequirement;

  /** Existing architecture description */
  existingArchitecture?: string;

  /** Codebase context (patterns, conventions) */
  codebaseContext?: string;

  /** Continue from previous design */
  thoughtSignature?: string;
}

/**
 * Response from architecture design
 */
export interface ArchitectureDesignResponse {
  /** Architecture design */
  design: ArchitectureDesign;

  /** Confidence in design */
  confidence: number;

  /** Thought signature for continuity */
  thoughtSignature?: string;
}
