package qa;
import a.Target;
import b.Target;
class Caller {
 Target target;
 void use(){ target.run(); } // ambiguous-import-receiver
}