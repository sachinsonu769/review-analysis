package qa;
class Caller {
 Worker worker;
 void one() { worker.run(7); } // exact-one
 void ten() { worker.run(1,2,3,4,5,6,7,8,9,10); } // exact-ten
}