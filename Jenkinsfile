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
        sshagent(['Ansible-server']) {
            sh 'ssh -o StrictHostKeyChecking=no ubuntu@172.31.3.94 "docker build -t my-app-image:latest -f /home/ubuntu/my-project/backend/Dockerfile /home/ubuntu/my-project"'
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

        stage('Deploy to Kubernetes via Ansible') {
            steps {
                sh """
                    sed -i 's|latest|${IMAGE_TAG}|g' k8s/backend-deployment.yml
                    ansible-playbook -i /etc/ansible/hosts ansible.yml
                """
            }
        }

    }

    post {
        success { echo '✅ Deployed successfully to Kubernetes!' }
        failure { echo '❌ Pipeline failed. Check logs above.' }
    }
}