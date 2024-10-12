import * as pulumi from "@pulumi/pulumi";
import * as digitalocean from "@pulumi/digitalocean";
import * as k8shelm from "@pulumi/kubernetes/helm/v3";
import * as k8s from "@pulumi/kubernetes";


const provider = new digitalocean.Provider("do-provider", {
    token: process.env.DIGITALOCEAN_TOKEN,
});


const cluster = new digitalocean.KubernetesCluster(`test-cluster`, {
    region: digitalocean.Region.SFO3,
    version: "1.31.1-do.3",
    nodePool: {
        name: "test-nodes",
        size: "s-1vcpu-2gb",
        nodeCount: 1,
    },
});

const ingressNamespace = new k8s.core.v1.Namespace("nginx-ingress", {
    metadata: {
        name: "nginx-ingress",
    },
});

const nginxIngressController = new k8shelm.Chart("nginx-ingress", {
    chart: "ingress-nginx",
    version: "4.10.3", // Replace with the latest stable version
    fetchOpts: {
        repo: "https://kubernetes.github.io/ingress-nginx",
    },
    namespace: ingressNamespace.metadata.name,
    values: {
        controller: {
            service: {
                type: "LoadBalancer", // Use "LoadBalancer" for public access or "ClusterIP" for internal access.
            },
        },
    },
});



const certManager = new k8shelm.Chart("cert-manager", {
    chart: "cert-manager",
    version: "v1.11.1", // Replace with the latest stable version
    fetchOpts: {
        repo: "https://charts.jetstack.io",
    },
    namespace: "default",
    values: {
        installCRDs: true, // This installs the Custom Resource Definitions (CRDs) needed by cert-manager
    },
});



// ClusterIssuer definition for Let's Encrypt (staging)
const clusterIssuer = new k8s.apiextensions.CustomResource("letsencrypt-cluster-issuer", {
    apiVersion: "cert-manager.io/v1",
    kind: "ClusterIssuer",
    metadata: {
        name: "letsencrypt",
    },
    spec: {
        acme: {
            email: "robertocarvalho508@gmail.com", // Seu email
            server: "https://acme-v02.api.letsencrypt.org/directory",
            privateKeySecretRef: {
                name: "letsencrypt", // Nome do secret onde será armazenada a chave privada
            },
            solvers: [
                {
                    http01: {
                        ingress: {
                            class: "nginx", // Usando Ingress NGINX para http-01
                        },
                    },
                },
                {
                    dns01: {
                        digitalocean: {
                            tokenSecretRef: {
                                name: "digitalocean-dns", // Nome do secret contendo o token da DigitalOcean
                                key: "access-token", // Chave dentro do secret com o token
                            },
                        },
                    },
                },
            ],
        },
    },
});


const newCertificate = new k8s.apiextensions.CustomResource("cert", {
    apiVersion: "cert-manager.io/v1",
    kind: "Certificate",
    metadata: {
        name: "cert",
        namespace: "default", // Replace with your namespace
    },
    spec: {
        secretName: "cert-tls", // Alterar o nome do secret para algo único
        issuerRef: {
            name: "letsencrypt", // Use the ClusterIssuer name
            kind: "ClusterIssuer",
        },
        commonName: "fabricaleads.com.br", // Replace with your domain
        dnsNames: ["fabricaleads.com.br","*.fabricaleads.com.br"], // Add your DNS names here
    },
});



// NGINX Deployment
const nginxDeployment = new k8s.apps.v1.Deployment("nginx-deployment", {
    metadata: {
        name: "nginx-deployment",
        namespace: "default", // Replace with your namespace if needed
    },
    spec: {
        replicas: 1, // Number of pod replicas
        selector: {
            matchLabels: {
                app: "nginx", // Label to select pods
            },
        },
        template: {
            metadata: {
                labels: {
                    app: "nginx", // Pod label
                },
            },
            spec: {
                containers: [
                    {
                        name: "nginx",
                        imagePullPolicy: "IfNotPresent",
                        image: "nginx:latest", // Default NGINX image
                        ports: [
                            {
                                containerPort: 80, // NGINX default port
                            },
                        ],
                    },
                ],
            },
        },
    },
});



// NGINX Service
const nginxService = new k8s.core.v1.Service("nginx-service", {
    metadata: {
        name: "nginx-service",
        namespace: "default",
    },
    spec: {
        selector: {
            app: "nginx", // Match the label in the deployment
        },
        ports: [
            {
                protocol: "TCP",
                port: 80, // Expose port 80
                targetPort: 80, // Send traffic to port 80 in the container
            },
        ],
        type: "ClusterIP", // Use LoadBalancer for external access, or ClusterIP for internal
    },
});



const ingress = new k8s.networking.v1.Ingress("next-ingress", {
    metadata: {
        name: "next-ingress",
        annotations: {
            "kubernetes.io/ingress.class": "nginx",
            "cert-manager.io/cluster-issuer": "letsencrypt",
        },
    },
    spec: {
        rules: [
            {
                host: "fabricaleads.com.br", // Regra para o domínio principal
                http: {
                    paths: [{
                        path: "/",
                        pathType: "Prefix",
                        backend: {
                            service: {
                                name: nginxService.metadata.name, // O serviço NGINX
                                port: { number: 80 },
                            },
                        },
                    }],
                },
            },
            {
                host: "app.fabricaleads.com.br", // Regra para o subdomínio
                http: {
                    paths: [{
                        path: "/",
                        pathType: "Prefix",
                        backend: {
                            service: {
                                name: nginxService.metadata.name, // O mesmo serviço NGINX, ou pode ser outro se necessário
                                port: { number: 80 },
                            },
                        },
                    }],
                },
            },
        ],
        tls: [{
            hosts: ["fabricaleads.com.br", "app.fabricaleads.com.br"], // Certificado cobrindo ambos os domínios
            secretName: "cert-tls", // Secret gerado pelo Cert-Manager contendo o certificado TLS
        }],
    },
});







