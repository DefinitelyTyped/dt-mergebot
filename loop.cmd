pushd ..\idembot
call git checkout -- *
call git pull
call npm update
call npm run build
call npm link
popd

pushd ..\definitelytyped-header-parser
call git checkout -- *
call git pull
call npm update
call npm run build
call npm link
popd


call git checkout -- *
call git pull
call npm update
call npm link idembot
call npm link definitelytyped-header-parser
call npm run build
call npm run wet
call npm run cleanproject
timeout 3600
loop
