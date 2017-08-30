pushd ..\idembot
call git pull
call npm build
popd

pushd ..\definitelytyped-header-parser
call git pull
call npm build
popd

call git pull
call npm update
call npm run wet
timeout 3600
loop
