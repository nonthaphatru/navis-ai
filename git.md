Your Daily Sync Workflow
// When starting work on Windows:

cd "C:\Users\nonth\Desktop\Works & Productivity\navis-ai"
git pull origin main



// When done — push to sync with Mac:

git add .
git commit -m "describe what you did"
git push origin main


// On Mac — pull the latest:

cd ~/path/to/navis-ai
git pull origin main