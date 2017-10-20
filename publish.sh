#!/bin/bash
if [ $1 == "" ] 
then
  echo "no commit msg found"
  exit 1
fi
echo "starting publish..."
cd public && \
rm -rf -- ^.git && \
git add -A && \
git commit -m $1 && \
git push origin HEAD:master && \
cd ..
git add -A && \
git commit -m $1 && \
git push 