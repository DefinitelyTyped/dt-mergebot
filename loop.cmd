pushd ..\idembot
call git pull
call npm update
call npm run build
call npm link
popd

pushd ..\definitelytyped-header-parser
call git pull
call npm update
call npm run build
call npm link
popd


call git pull
call npm update
call npm link idembot
call npm link definitelytyped-header-parser
call npm run build
call npm run wet
timeout 3600
loop
