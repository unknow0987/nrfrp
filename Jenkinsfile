pipeline {
    agent any

    environment {
        DOCKERHUB_USER = 'shivam1295334'
        IMAGE_NAME     = 'nrfrp-backend'
        IMAGE_TAG      = "${BUILD_NUMBER}"
    }

    stages {

        stage('Clone Repo') {
            steps {
                git branch: 'main', url: 'https://github.com/unknow0987/nrfrp.git'
            }
        }

        stage('Build Docker Image') {
            steps {
                dir('backend') {
                    sh "docker build -t ${DOCKERHUB_USER}/${IMAGE_NAME}:${IMAGE_TAG} ."
                }
            }
        }

        stage('Push to DockerHub') {
            steps {
                withCredentials([usernamePassword(
                    credentialsId: 'dockerhub-creds',
                    usernameVariable: 'DOCKER_USER',
                    passwordVariable: 'DOCKER_PASS'
                )]) {
                    sh "echo $DOCKER_PASS | docker login -u $DOCKER_USER --password-stdin"
                    sh "docker push ${DOCKERHUB_USER}/${IMAGE_NAME}:${IMAGE_TAG}"
                }
            }
        }

        stage('Deploy to Kubernetes') {
            steps {
                sh """
                    sed -i 's|latest|${IMAGE_TAG}|g' k8s/backend-deployment.yml
                    kubectl apply -f k8s/postgres-deployment.yml
                    kubectl apply -f k8s/postgres-service.yml
                    kubectl apply -f k8s/redis-deployment.yml
                    kubectl apply -f k8s/redis-service.yml
                    kubectl apply -f k8s/backend-deployment.yml
                    kubectl apply -f k8s/backend-service.yml
                """
            }
        }

    }

    post {
        success { echo '✅ Deployed successfully to Kubernetes!' }
        failure { echo '❌ Pipeline failed. Check logs above.' }
    }
}