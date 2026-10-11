package qa;
class Caller {
 Worker worker;
 void use(){ worker.run("x", "y"); } // vararg-overload
}