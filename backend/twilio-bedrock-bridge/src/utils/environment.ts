/**
 * Environment detection utilities for different deployment contexts
 */

export interface EnvironmentInfo {
  isECS: boolean;
  isFargate: boolean;
  isKubernetes: boolean;
  isEKS: boolean;
  isLocal: boolean;
  isContainer: boolean;
  platform: 'ecs-fargate' | 'ecs-ec2' | 'eks' | 'kubernetes' | 'local' | 'container' | 'unknown';
  region?: string;
  availabilityZone?: string;
  namespace?: string;
  podName?: string;
  nodeName?: string;
  clusterName?: string;
}

/**
 * Detect the current deployment environment
 */
export function detectEnvironment(): EnvironmentInfo {
  const isECS = !!(
    process.env.ECS_CONTAINER_METADATA_URI_V4 ||
    process.env.ECS_CONTAINER_METADATA_URI
  );

  const isFargate = !!(
    process.env.ECS_CONTAINER_METADATA_URI_V4 &&
    process.env.AWS_EXECUTION_ENV?.includes('Fargate')
  );

  // Kubernetes detection - multiple indicators
  const isKubernetes = !!(
    process.env.KUBERNETES_SERVICE_HOST ||
    process.env.KUBERNETES_SERVICE_PORT ||
    process.env.KUBERNETES_PORT ||
    process.env.KUBE_DNS_PORT ||
    process.env.HOSTNAME?.match(/^[a-z0-9]([a-z0-9\-]*[a-z0-9])?-[a-f0-9]{8,10}-[a-z0-9]{5}$/) // Pod naming pattern
  );

  // EKS detection - Kubernetes + AWS metadata
  const isEKS = isKubernetes && !!(
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION ||
    process.env.AWS_ROLE_ARN ||
    process.env.AWS_WEB_IDENTITY_TOKEN_FILE || // IRSA (IAM Roles for Service Accounts)
    process.env.EKS_CLUSTER_NAME
  );

  const isContainer = !!(
    isECS ||
    isKubernetes ||
    process.env.DOCKER_CONTAINER ||
    process.env.container // Set by some container runtimes
  );

  const isLocal = !isECS && !isKubernetes && !isContainer;

  // Determine platform with priority order
  let platform: EnvironmentInfo['platform'] = 'unknown';
  if (isFargate) {
    platform = 'ecs-fargate';
  } else if (isECS) {
    platform = 'ecs-ec2';
  } else if (isEKS) {
    platform = 'eks';
  } else if (isKubernetes) {
    platform = 'kubernetes';
  } else if (isContainer) {
    platform = 'container';
  } else if (isLocal) {
    platform = 'local';
  }

  // Gather Kubernetes-specific metadata
  const kubernetesMetadata = isKubernetes ? {
    namespace: process.env.KUBERNETES_NAMESPACE || process.env.POD_NAMESPACE,
    podName: process.env.HOSTNAME || process.env.POD_NAME,
    nodeName: process.env.NODE_NAME || process.env.KUBERNETES_NODE_NAME,
    clusterName: process.env.EKS_CLUSTER_NAME || process.env.CLUSTER_NAME || process.env.KUBE_CLUSTER_NAME
  } : {};

  return {
    isECS,
    isFargate,
    isKubernetes,
    isEKS,
    isLocal,
    isContainer,
    platform,
    region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION,
    availabilityZone: process.env.AWS_AVAILABILITY_ZONE || process.env.AWS_AZ,
    ...kubernetesMetadata
  };
}

/**
 * Get environment-specific OTEL configuration
 */
export function getOTELConfig(): Record<string, string> {
  const env = detectEnvironment();
  const config: Record<string, string> = {};

  // Base configuration
  config.OTEL_SERVICE_NAME = process.env.OTEL_SERVICE_NAME || 'twilio-bedrock-bridge';
  config.OTEL_SERVICE_VERSION = process.env.OTEL_SERVICE_VERSION || '0.1.0';

  // Environment-specific resource detectors
  if (env.isFargate) {
    // ECS Fargate - avoid detectors that require machine-id or host access
    config.OTEL_RESOURCE_DETECTORS = 'env,process,serviceinstance';
  } else if (env.isECS) {
    // ECS EC2 - can use more detectors
    config.OTEL_RESOURCE_DETECTORS = 'env,host,os,process,serviceinstance,ecs';
  } else if (env.isEKS) {
    // EKS - Kubernetes + AWS detectors
    config.OTEL_RESOURCE_DETECTORS = 'env,host,os,process,serviceinstance,k8s';
  } else if (env.isKubernetes) {
    // Generic Kubernetes - k8s detector available
    config.OTEL_RESOURCE_DETECTORS = 'env,host,os,process,serviceinstance,k8s';
  } else if (env.isContainer) {
    // Other containers - safe subset
    config.OTEL_RESOURCE_DETECTORS = 'env,host,os,process,serviceinstance';
  } else {
    // Local development - all detectors available
    config.OTEL_RESOURCE_DETECTORS = 'env,host,os,process,serviceinstance';
  }

  // Resource attributes
  const resourceAttributes = [
    `service.name=${config.OTEL_SERVICE_NAME}`,
    `service.version=${config.OTEL_SERVICE_VERSION}`,
    `deployment.environment=${process.env.NODE_ENV || 'development'}`
  ];

  if (env.region) {
    resourceAttributes.push(`cloud.region=${env.region}`);
  }

  if (env.isECS) {
    resourceAttributes.push('cloud.provider=aws');
    resourceAttributes.push(`cloud.platform=aws_${env.isFargate ? 'fargate' : 'ecs'}`);
  } else if (env.isEKS) {
    resourceAttributes.push('cloud.provider=aws');
    resourceAttributes.push('cloud.platform=aws_eks');
    if (env.clusterName) {
      resourceAttributes.push(`k8s.cluster.name=${env.clusterName}`);
    }
  } else if (env.isKubernetes) {
    resourceAttributes.push('cloud.platform=kubernetes');
    if (env.clusterName) {
      resourceAttributes.push(`k8s.cluster.name=${env.clusterName}`);
    }
  }

  // Add Kubernetes-specific attributes
  if (env.isKubernetes) {
    if (env.namespace) {
      resourceAttributes.push(`k8s.namespace.name=${env.namespace}`);
    }
    if (env.podName) {
      resourceAttributes.push(`k8s.pod.name=${env.podName}`);
    }
    if (env.nodeName) {
      resourceAttributes.push(`k8s.node.name=${env.nodeName}`);
    }
  }

  config.OTEL_RESOURCE_ATTRIBUTES = resourceAttributes.join(',');

  return config;
}

/**
 * Check if the current environment supports OTEL features
 */
export function getOTELCapabilities() {
  const env = detectEnvironment();

  return {
    supportsTracing: !env.isFargate, // Fargate has machine-id issues with OTEL
    supportsMetrics: !env.isFargate, // Fargate metrics also affected by resource detection
    supportsResourceDetection: !env.isFargate, // Fargate has limited resource detection
    supportsMachineId: env.isLocal, // Only local environments typically have machine-id
    supportsHostMetrics: !env.isFargate && !env.isKubernetes, // Fargate and some K8s setups don't have host access
    supportsK8sMetrics: env.isKubernetes, // Kubernetes-specific metrics available
    supportsServiceMesh: env.isKubernetes, // Service mesh integration possible in K8s
    supportsXRay: true, // X-Ray works in all AWS environments
    supportsXRayDaemon: !env.isFargate, // Daemon mode only works outside Fargate
    requiresXRayDirectMode: env.isFargate, // Fargate requires direct API mode
    recommendsFallback: env.isFargate, // Strongly recommend fallback for Fargate
    shouldSkipOTEL: env.isFargate, // Skip OTEL entirely in Fargate unless forced
    shouldUseXRayForTracing: env.isFargate, // Use X-Ray instead of OTEL in Fargate
    hasClusterInfo: env.isKubernetes && !!env.clusterName, // Has cluster identification
    hasNamespaceIsolation: env.isKubernetes && !!env.namespace // Has namespace context
  };
}

// Export singleton instance
export const currentEnvironment = detectEnvironment();
export const otelConfig = getOTELConfig();
export const otelCapabilities = getOTELCapabilities();

// Log environment detection on module load (skip in test environment)
if (process.env.NODE_ENV !== 'test' && !process.env.JEST_WORKER_ID) {
  console.log(`Environment detected: ${currentEnvironment.platform}`, {
    isECS: currentEnvironment.isECS,
    isFargate: currentEnvironment.isFargate,
    isKubernetes: currentEnvironment.isKubernetes,
    isEKS: currentEnvironment.isEKS,
    isContainer: currentEnvironment.isContainer,
    region: currentEnvironment.region,
    ...(currentEnvironment.isKubernetes && {
      namespace: currentEnvironment.namespace,
      podName: currentEnvironment.podName,
      clusterName: currentEnvironment.clusterName
    })
  });
}

if (otelCapabilities.recommendsFallback) {
  console.log('OTEL fallback mode recommended for this environment');
}

if (currentEnvironment.isKubernetes) {
  console.log('Kubernetes environment detected', {
    isEKS: currentEnvironment.isEKS,
    hasClusterInfo: otelCapabilities.hasClusterInfo,
    hasNamespaceIsolation: otelCapabilities.hasNamespaceIsolation
  });
}